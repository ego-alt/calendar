from datetime import datetime
from flask import Blueprint, jsonify, request, render_template
from flask_login import current_user
from utils import get_month_data


index_blueprint = Blueprint("index_routes", __name__)


@index_blueprint.route("/")
def index():
    today = datetime.now()
    calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
        today.year,
        today.month,
        current_user.id if current_user.is_authenticated else None,
    )

    return render_template(
        "index.html",
        calendar_data=calendar_data,
        date_label=today.strftime("%B %Y"),
        current_year=today.year,
        current_month=today.month,
        current_day=today.day,
        mood_colors=mood_colors,
        days_with_events=days_with_events,
        days_with_marker=days_with_marker,
    )


@index_blueprint.route("/get_month", methods=["GET"])
def get_month():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    # Handle year transition
    if month == 13:
        month = 1
        year += 1

    calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
        year, month, current_user.id if current_user.is_authenticated else None
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


@index_blueprint.route("/get_year", methods=["GET"])
def get_year():
    year = int(request.args.get("year"))

    months_data = []
    for month in range(1, 13):
        calendar_data, mood_colors, days_with_events, days_with_marker = get_month_data(
            year, month, current_user.id if current_user.is_authenticated else None
        )

        months_data.append(
            {
                "month": month,
                "calendar_data": calendar_data,
                "mood_colors": mood_colors,
                "days_with_events": days_with_events,
                "days_with_marker": days_with_marker,
            }
        )

    return jsonify({"status": "success", "year": year, "months": months_data})
