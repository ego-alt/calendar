from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, render_template, request

from utils import get_month_data, get_week_data, get_year_data

from ._helpers import current_user_id

index_blueprint = Blueprint("index_routes", __name__)


def build_index_context() -> dict:
    """Template context for the calendar shell — shared by `/` and the `/stats`
    deep-link, since both render the same single-page app shell."""
    today = datetime.now()
    calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
        today.year, today.month, current_user_id()
    )
    return {
        "calendar_data": calendar_data,
        "date_label": today.strftime("%B %Y"),
        "current_year": today.year,
        "current_month": today.month,
        "current_day": today.day,
        "mood_colors": mood_colors,
        "days_with_events": days_with_events,
        "days_with_marker": days_with_marker,
    }


@index_blueprint.route("/")
def index():
    return render_template("index.html", **build_index_context(), active_view="calendar")


@index_blueprint.route("/get_month", methods=["GET"])
def get_month():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))

    calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
        year, month, current_user_id()
    )

    return jsonify(
        {
            "calendar_data": calendar_data,
            "month_label": datetime(year, month, 1).strftime("%B %Y"),
            "mood_colors": mood_colors,
            "days_with_events": days_with_events,
            "days_with_marker": days_with_marker,
        }
    )


@index_blueprint.route("/get_week", methods=["GET"])
def get_week():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    day = int(request.args.get("day"))

    week_data = get_week_data(year, month, day, current_user_id())

    week_start = date.fromisoformat(week_data["week_start"])
    week_end = week_start + timedelta(days=6)
    if week_start.month == week_end.month:
        label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%d, %Y')}"
    elif week_start.year == week_end.year:
        label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
    else:
        label = f"{week_start.strftime('%b %d, %Y')} – {week_end.strftime('%b %d, %Y')}"

    return jsonify({**week_data, "week_label": label, "status": "success"})


@index_blueprint.route("/get_year", methods=["GET"])
def get_year():
    year = int(request.args.get("year"))
    months_data = get_year_data(year, current_user_id())
    return jsonify({"status": "success", "year": year, "months": months_data})
