from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, redirect, render_template, request, url_for
from flask_login import current_user

from models import Event, db
from query_router import route_query
from search_index import search

from ._helpers import json_login_required
from .events import retrieve_event_data

search_blueprint = Blueprint("search", __name__, url_prefix="/search")


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None


def _distinct(column, user_id):
    """The user's known values for a column (for who/where query routing)."""
    rows = (
        db.session.query(column)
        .filter(Event.user_id == user_id, column.isnot(None), column != "")
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


@search_blueprint.route("")
def search_page():
    # Deep-link / refresh entry: render the calendar shell with the Search view
    # pre-selected (the shell swaps views client-side from there — no reload).
    if not current_user.is_authenticated:
        return redirect(url_for("index_routes.index"))
    from .index import build_index_context

    return render_template("index.html", **build_index_context(), active_view="search")


@search_blueprint.route("/data", methods=["GET"])
@json_login_required
def search_events():
    # Route the typed query first: pull date / mood / who / where out of it (who and
    # where are matched against the user's own known values), leaving the residual as
    # the content query (see query_router.route_query).
    uid = current_user.id
    routed = route_query(
        request.args.get("q", ""),
        today=date.today(),
        people=_distinct(Event.with_who, uid),
        places=_distinct(Event.where, uid),
    )

    explicit_from = _parse_date(request.args.get("from"))
    explicit_to = _parse_date(request.args.get("to"))
    if explicit_to is not None:
        explicit_to = explicit_to + timedelta(days=1)  # make the `to` day inclusive
    explicit_mood = request.args.get("mood") or None
    explicit_who = request.args.get("who") or None
    explicit_where = request.args.get("where") or None

    # Explicit controls win; otherwise fall back to what the router parsed.
    if explicit_from or explicit_to:
        date_from, date_to, date_label = explicit_from, explicit_to, None
    else:
        date_from, date_to, date_label = routed.date_from, routed.date_to, routed.date_label
    mood = explicit_mood or routed.mood
    who = explicit_who or routed.who
    where = explicit_where or routed.where

    try:
        limit = min(int(request.args.get("limit", 20)), 100)
    except (TypeError, ValueError):
        limit = 20

    matches = search(
        uid,
        routed.residual_q,
        date_from=date_from,
        date_to=date_to,
        mood=mood,
        who=who,
        where=where,
        limit=limit,
    )

    # Chip labels: only what the router actually applied (explicit controls show
    # themselves in their own inputs).
    labels = []
    if date_label:
        labels.append(date_label)
    if not explicit_who and routed.who:
        labels.append(f"with: {routed.who}")
    if not explicit_where and routed.where:
        labels.append(f"at: {routed.where}")
    if not explicit_mood and routed.mood:
        labels.append(f"mood: {routed.mood}")

    results = [retrieve_event_data(event) for event, _ in matches]
    return jsonify({"status": "success", "results": results, "parsed": {"labels": labels}})
