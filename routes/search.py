from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user

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


@search_blueprint.route("", methods=["GET"])
@json_login_required
def search_events():
    # Route the typed query first: pull a date range / mood out of it, leaving the
    # residual as the content query (see query_router.route_query).
    routed = route_query(request.args.get("q", ""), today=date.today())

    explicit_from = _parse_date(request.args.get("from"))
    explicit_to = _parse_date(request.args.get("to"))
    if explicit_to is not None:
        explicit_to = explicit_to + timedelta(days=1)  # make the `to` day inclusive
    explicit_mood = request.args.get("mood") or None

    # Explicit controls win; otherwise fall back to what the router parsed.
    if explicit_from or explicit_to:
        date_from, date_to, date_label = explicit_from, explicit_to, None
    else:
        date_from, date_to, date_label = routed.date_from, routed.date_to, routed.date_label
    mood = explicit_mood or routed.mood

    try:
        limit = min(int(request.args.get("limit", 20)), 100)
    except (TypeError, ValueError):
        limit = 20

    matches = search(
        current_user.id,
        routed.residual_q,
        date_from=date_from,
        date_to=date_to,
        mood=mood,
        who=request.args.get("who") or None,
        where=request.args.get("where") or None,
        limit=limit,
    )

    # Chip labels: only what the router actually applied (explicit controls show
    # themselves in their own inputs).
    labels = []
    if date_label:
        labels.append(date_label)
    if not explicit_mood and routed.mood:
        labels.append(f"mood: {routed.mood}")

    results = []
    for event, score in matches:
        data = retrieve_event_data(event)
        data["score"] = round(float(score), 4) if score is not None else None
        results.append(data)
    return jsonify({
        "status": "success",
        "results": results,
        "parsed": {"labels": labels, "residual_q": routed.residual_q},
    })
