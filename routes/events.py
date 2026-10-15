from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from models import DailyLog, Event, SubEvent, db
from search_index import index_event_safe, remove_event_safe
from trash import now, purge_deleted
from utils import parse_event_datetime

from ._helpers import json_login_required

event_blueprint = Blueprint("events", __name__, url_prefix="/events")


def retrieve_events_within_range(start_date, end_date):
    """Query events for the current user and specified dates (subevents eager-loaded)."""
    effective_end = func.coalesce(Event.end_time, Event.start_time)
    return (
        Event.query.options(selectinload(Event.subevents))
        .filter(
            Event.user_id == current_user.id,
            Event.start_time < end_date,
            effective_end >= start_date,
        )
        .order_by(Event.start_time)
        .all()
    )


def retrieve_event_data(event: Event | SubEvent):
    """ "Query and return event or subevent details."""
    return {
        "id": event.id,
        "name": event.name,
        "start_time": event.start_time.strftime("%Y-%m-%d %H:%M"),
        "end_time": event.end_time.strftime("%Y-%m-%d %H:%M") if event.end_time else None,
        "notes": event.notes,
        "with_who": event.with_who,
        "where": event.where,
    }


def is_within_parent_date(parent: Event, start_datetime, end_datetime) -> bool:
    """ "Validate whether the subevent lies within the time frame of its parent."""
    return start_datetime >= parent.start_time and (
        end_datetime <= parent.end_time if parent.end_time else True
    )


class EntryError(ValueError):
    """An entry the user sent that can't be saved; the message is shown as is."""


def _fmt_span(start, end):
    fmt = lambda d: d.strftime("%-d %b %H:%M")  # noqa: E731
    return f"{fmt(start)}–{fmt(end)}" if end else fmt(start)


def read_entry(data: dict, parent: Event | None = None):
    """Validate an entry payload → (name, start, end). Raises EntryError with a
    message fit for the user."""
    data = data or {}
    name = (data.get("name") or "").strip()
    if not name:
        raise EntryError("Give this entry a name.")
    try:
        start = parse_event_datetime(data.get("start_date"), data.get("start_time"))
        end = parse_event_datetime(
            data.get("end_date") or data.get("start_date"), data.get("end_time"), is_end=True
        )
    except ValueError:
        raise EntryError("That date or time doesn't look right.") from None
    if end < start:
        raise EntryError("The end is before the start.")
    if parent and not is_within_parent_date(parent, start, end):
        span = _fmt_span(parent.start_time, parent.end_time)
        raise EntryError(f"This moment falls outside its entry ({span}).")
    return name, start, end


def edit_event_data(event: Event | SubEvent, data: dict, parent: Event | None = None):
    """Edit the event or subevent details (raises EntryError on bad input)."""
    name, start_datetime, end_datetime = read_entry(data, parent)
    if isinstance(event, Event):
        outside = [
            s for s in event.subevents
            if not (
                start_datetime <= s.start_time
                and (s.end_time or s.start_time) <= end_datetime
            )
        ]
        if outside:
            raise EntryError(
                f"“{outside[0].name}” would fall outside the new time. Move or remove it first."
            )

    event.name = name
    event.start_time = start_datetime
    event.end_time = end_datetime
    event.notes = data.get("notes")
    event.with_who = data.get("with_who")
    event.where = data.get("where")

    db.session.commit()
    return True


def create_event(event_class, data: dict, parent: Event | None = None, **kwargs):
    """Create a new event or subevent (raises EntryError on bad input)."""
    name, start_datetime, end_datetime = read_entry(data, parent)

    event_attrs = {
        **kwargs,
        "name": name,
        "start_time": start_datetime,
        "end_time": end_datetime,
        "notes": data.get("notes"),
        "with_who": data.get("with_who"),
        "where": data.get("where"),
    }
    event = event_class(**event_attrs)
    db.session.add(event)
    db.session.commit()
    return event


def delete_event(event: Event | SubEvent):
    """Soft-delete an event or subevent (undoable; purged after 30 days)."""
    event.deleted_at = now()
    db.session.commit()
    purge_deleted()


@event_blueprint.route("/", methods=["GET", "POST"])
@json_login_required
def events():
    if request.method == "GET":
        year = int(request.args.get("year"))
        month = int(request.args.get("month"))
        day = int(request.args.get("day"))
        start_date = datetime(year, month, day)
        end_date = start_date + timedelta(days=1)
        events = retrieve_events_within_range(start_date, end_date)

        events_data = []
        for event in events:
            subevents = [
                s
                for s in event.subevents
                if start_date <= s.start_time < end_date
            ]
            subevents.sort(key=lambda s: s.start_time)

            subevents_data = [retrieve_event_data(subevent) for subevent in subevents]
            events_data.append({**retrieve_event_data(event), "subevents": subevents_data})

        # The day's mood and marker travel with its entries, so the day panel
        # can show and change them without a second request.
        log = DailyLog.query.filter_by(user_id=current_user.id, date=start_date.date()).first()
        return jsonify({
            "status": "success",
            "events": events_data,
            "mood": log.mood_key if log else None,
            "has_marker": bool(log and log.has_marker),
        })

    try:
        event = create_event(Event, request.json, user_id=current_user.id)
    except EntryError as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    index_event_safe(event)
    return jsonify({"status": "success", "message": "Saved", "id": event.id})


@event_blueprint.route("/<int:event_id>", methods=["PUT", "DELETE"])
@json_login_required
def manage_event(event_id):
    event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()

    if not event:
        return jsonify({"status": "error", "message": "That entry no longer exists."}), 404

    if request.method == "DELETE":
        remove_event_safe(event.id)
        delete_event(event)
        return jsonify({"status": "success", "message": "Deleted"})

    try:
        edit_event_data(event, request.json)
    except EntryError as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    index_event_safe(event)
    return jsonify({"status": "success", "message": "Saved"})


@event_blueprint.route("/<int:event_id>/restore", methods=["POST"])
@json_login_required
def restore_event(event_id):
    """Undo a delete."""
    event = (
        Event.query.filter_by(id=event_id, user_id=current_user.id)
        .execution_options(include_deleted=True)
        .first()
    )
    if not event:
        return jsonify({"status": "error", "message": "That entry can't be brought back."}), 404
    event.deleted_at = None
    db.session.commit()
    index_event_safe(event)
    return jsonify({"status": "success"})


@event_blueprint.route("/subevents/<int:subevent_id>/restore", methods=["POST"])
@json_login_required
def restore_subevent(subevent_id):
    """Undo a delete of a moment."""
    subevent = (
        SubEvent.query.join(Event)
        .filter(SubEvent.id == subevent_id, Event.user_id == current_user.id)
        .execution_options(include_deleted=True)
        .first()
    )
    if not subevent:
        return jsonify({"status": "error", "message": "That moment can't be brought back."}), 404
    subevent.deleted_at = None
    db.session.commit()
    parent = db.session.get(Event, subevent.event_id)
    if parent is not None:
        index_event_safe(parent)
    return jsonify({"status": "success"})


@event_blueprint.route("/<int:event_id>/subevents", methods=["POST"])
@json_login_required
def subevents(event_id):
    parent_event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()
    if not parent_event:
        return jsonify({"status": "error", "message": "That entry no longer exists."}), 404

    try:
        create_event(SubEvent, request.json, parent=parent_event, event_id=event_id)
    except EntryError as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    index_event_safe(parent_event)  # reindex parent with the new subevent folded in
    return jsonify({"status": "success", "message": "Subevent created successfully"})


@event_blueprint.route("/subevents/<int:subevent_id>", methods=["PUT", "DELETE", "GET"])
@json_login_required
def manage_subevent(subevent_id):
    subevent = (
        SubEvent.query.join(Event)
        .filter(SubEvent.id == subevent_id, Event.user_id == current_user.id)
        .first()
    )

    if not subevent:
        return jsonify({"status": "error", "message": "That moment no longer exists."}), 404

    if request.method == "DELETE":
        parent_id = subevent.event_id
        delete_event(subevent)
        parent_event = db.session.get(Event, parent_id)
        if parent_event is not None:
            index_event_safe(parent_event)
        return jsonify({"status": "success", "message": "Subevent deleted"})

    if request.method == "GET":
        return jsonify({"status": "success", "subevent": retrieve_event_data(subevent)})

    parent_event = db.session.get(Event, subevent.event_id)
    try:
        edit_event_data(subevent, request.json, parent_event)
    except EntryError as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    index_event_safe(parent_event)  # reindex parent with the edited subevent text
    return jsonify({"status": "success", "message": "Subevent updated"})


@event_blueprint.route("/month", methods=["GET"])
@json_login_required
def month_events():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    start_date = datetime(year, month, 1)
    end_date = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    events_data = []
    for event in retrieve_events_within_range(start_date, end_date):
        subevents = sorted(event.subevents, key=lambda s: s.start_time)
        event_data = retrieve_event_data(event)
        event_data["subevents"] = [retrieve_event_data(s) for s in subevents]
        events_data.append(event_data)
    return jsonify({"status": "success", "events": events_data})
