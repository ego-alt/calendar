from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from flask_login import current_user
from models import db, Event, SubEvent
from utils import parse_event_datetime


event_blueprint = Blueprint("events", __name__, url_prefix="/events")


def retrieve_events_within_range(start_date, end_date):
    """Query events for the current user and specified dates."""
    return (
        Event.query.filter(
            Event.user_id == current_user.id,
            Event.start_time < end_date,
            Event.end_time >= start_date,
        )
        .order_by(Event.start_time)
        .all()
    )
            

def retrieve_event_data(event: Event | SubEvent):
    """"Query and return event or subevent details."""
    return {
        "id": event.id,
        "name": event.name,
        "start_time": event.start_time.strftime("%Y-%m-%d %H:%M"),
        "end_time": event.end_time.strftime("%Y-%m-%d %H:%M") if event.end_time else None,
        "notes": event.notes,
        "with_who": event.with_who,
        "where": event.where
    }


def is_within_parent_date(parent: Event, start_datetime, end_datetime) -> bool:
    """"Validate whether the subevent lies within the time frame of its parent."""
    return (
        start_datetime >= parent.start_time
        and (end_datetime <= parent.end_time if parent.end_time else True)
    )


def edit_event_data(event: Event | SubEvent, data: dict, parent: Event | None=None):
    """Edit the event or subevent details."""
    start_datetime = parse_event_datetime(data["start_date"], data.get("start_time"))
    end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

    if parent and not is_within_parent_date(parent, start_datetime, end_datetime):
        return False

    event.name = data["name"]
    event.start_time = start_datetime
    event.end_time = end_datetime
    event.notes = data.get("notes")
    event.with_who = data.get("with_who")
    event.where = data.get("where")

    db.session.commit()
    return True


def create_event(event_class, data: dict, parent: Event | None=None, **kwargs):
    """Create a new event or subevent."""
    start_datetime = parse_event_datetime(data["start_date"], data.get("start_time"))
    end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

    if parent and not is_within_parent_date(parent, start_datetime, end_datetime):
        return False

    event_attrs = {
        **kwargs,
        "name": data["name"],
        "start_time": start_datetime,
        "end_time": end_datetime,
        "notes": data.get("notes"),
        "with_who": data.get("with_who"),
        "where": data.get("where"),
    }
    event = event_class(**event_attrs)
    db.session.add(event)
    db.session.commit()
    return True


def delete_event(event: Event | SubEvent):
    """Delete an event or subevent."""
    db.session.delete(event)
    db.session.commit()


@event_blueprint.route("/", methods=["GET", "POST"])
def events():
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    try:
        if request.method == "GET":
            year = int(request.args.get('year'))
            month = int(request.args.get('month'))
            day = int(request.args.get('day'))
            start_date = datetime(year, month, day)
            end_date = start_date + timedelta(days=1)
            events = retrieve_events_within_range(start_date, end_date)

            events_data = []
            for event in events:
                subevents = SubEvent.query.filter(
                    SubEvent.event_id == event.id,
                    SubEvent.start_time >= start_date,
                    SubEvent.start_time < end_date
                ).order_by(SubEvent.start_time).all()
                
                subevents_data = [retrieve_event_data(subevent) for subevent in subevents]
                events_data.append({**retrieve_event_data(event), "subevents": subevents_data})

            return jsonify({"status": "success", "events": events_data})

        # POST method
        else:
            create_event(Event, request.json, user_id=current_user.id)
            return jsonify({"status": "success", "message": "Event created successfully"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/<int:event_id>", methods=["PUT", "DELETE"])
def manage_event(event_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    try:
        event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()

        if not event:
            return jsonify({"status": "error", "message": "Event not found"}), 404

        if request.method == "DELETE":
            delete_event(event)
            return jsonify({"status": "success", "message": "Event deleted"})

        # PUT method
        edit_event_data(event, request.json)
        return jsonify({"status": "success", "message": "Event updated"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/<int:event_id>/subevents", methods=["POST"])
def subevents(event_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    
    try:
        # First verify the parent event belongs to the current user
        parent_event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()
        if not parent_event:
            return jsonify({"status": "error", "message": "Event not found"}), 404

        return (
            (jsonify({"status": "error", "message": "Subevent must occur within the parent event's timeframe"}), 400)
            if not create_event(SubEvent, request.json, event_id=event_id)
            else jsonify({"status": "success", "message": "Subevent created successfully"})
        )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/subevents/<int:subevent_id>", methods=["PUT", "DELETE", "GET"])
def manage_subevent(subevent_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    
    try:
        # Find the subevent and verify it belongs to the current user
        subevent = SubEvent.query.join(Event).filter(
            SubEvent.id == subevent_id,
            Event.user_id == current_user.id
        ).first()
        
        if not subevent:
            return jsonify({"status": "error", "message": "Subevent not found"}), 404
        
        if request.method == "DELETE":
            delete_event(subevent)
            return jsonify({"status": "success", "message": "Subevent deleted"})
        
        if request.method == "GET":
            return jsonify({"status": "success", "subevent": retrieve_event_data(subevent)})
        
        # PUT method
        parent_event = Event.query.get(subevent.event_id)
        return (
            (jsonify({"status": "error",  "message": "Subevent must occur within the parent event's timeframe"}), 400)
            if not edit_event_data(subevent, request.json, parent_event)
            else jsonify({"status": "success", "message": "Subevent updated"})
        )
    
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/month", methods=["GET"])
def month_events():
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
        start_date = datetime(year, month, 1)
        end_date = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
        events_data = [
            retrieve_event_data(event)
            for event in retrieve_events_within_range(start_date, end_date)
        ]
        return jsonify({"status": "success", "events": events_data})
    
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
