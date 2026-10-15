from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, render_template, request

from models import DailyLog, Event
from utils import get_month_data, get_month_details, get_week_data, get_year_data

from ._helpers import current_user_id, json_login_required

index_blueprint = Blueprint("index_routes", __name__)


def build_index_context() -> dict:
    """Template context for the calendar shell — shared by `/` and the `/stats`
    deep-link, since both render the same single-page app shell."""
    today = datetime.now()
    calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
        today.year, today.month, current_user_id()
    )
    uid = current_user_id()
    # First run: no moods and no entries yet → a short how-to card.
    first_run = bool(uid) and (
        DailyLog.query.filter_by(user_id=uid).first() is None
        and Event.query.filter_by(user_id=uid).first() is None
    )
    return {
        "first_run": first_run,
        "calendar_data": calendar_data,
        "date_label": today.strftime("%B %Y"),
        "current_year": today.year,
        "current_month": today.month,
        "current_day": today.day,
        "mood_colors": mood_colors,
        "days_with_events": days_with_events,
        "days_with_marker": days_with_marker,
        "day_info": get_month_details(today.year, today.month, uid),
    }


@index_blueprint.route("/")
def index():
    return render_template("index.html", **build_index_context(), active_view="calendar")


@index_blueprint.route("/get_month", methods=["GET"])
@json_login_required
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
            "day_info": get_month_details(year, month, current_user_id()),
        }
    )


@index_blueprint.route("/get_week", methods=["GET"])
@json_login_required
def get_week():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    day = int(request.args.get("day"))

    week_data = get_week_data(year, month, day, current_user_id())

    week_start = date.fromisoformat(week_data["week_start"])
    week_end = week_start + timedelta(days=6)
    # Day-month order, like every other date in the app: "5–11 Oct 2026",
    # "28 Sep – 4 Oct 2026", "28 Dec 2025 – 3 Jan 2026".
    def d(x, *, month=True, year=False):
        return f"{x.day}" + (f" {x:%b}" if month else "") + (f" {x.year}" if year else "")

    if week_start.month == week_end.month:
        label = f"{d(week_start, month=False)}–{d(week_end, year=True)}"
    elif week_start.year == week_end.year:
        label = f"{d(week_start)} – {d(week_end, year=True)}"
    else:
        label = f"{d(week_start, year=True)} – {d(week_end, year=True)}"

    return jsonify({**week_data, "week_label": label, "status": "success"})


@index_blueprint.route("/get_year", methods=["GET"])
@json_login_required
def get_year():
    year = int(request.args.get("year"))
    months_data = get_year_data(year, current_user_id())
    return jsonify({"status": "success", "year": year, "months": months_data})
