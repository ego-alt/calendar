from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_login import current_user

from models import DailyLog, db
from moods import MOOD_BY_KEY

from ._helpers import json_login_required

mood_blueprint = Blueprint("mood", __name__, url_prefix="/mood")


@mood_blueprint.route("/update", methods=["POST"])
@json_login_required
def update_mood():
    data = request.json
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

    key = data.get("mood")
    if key is None:
        if daily_log:
            daily_log.mood_key = None
            if not daily_log.has_marker and not daily_log.attachments:
                db.session.delete(daily_log)
    else:
        if key not in MOOD_BY_KEY:
            return jsonify({"status": "error", "message": "unknown mood"}), 400
        if daily_log:
            daily_log.mood_key = key
        else:
            daily_log = DailyLog(user_id=current_user.id, date=date, mood_key=key)
            db.session.add(daily_log)

    db.session.commit()
    return jsonify({"status": "success"})


@mood_blueprint.route("/marker/toggle", methods=["POST"])
@json_login_required
def toggle_marker():
    data = request.json
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

    if daily_log:
        has_marker = not daily_log.has_marker
        daily_log.has_marker = has_marker
        if not daily_log.has_marker and daily_log.mood_key is None and not daily_log.attachments:
            db.session.delete(daily_log)
    else:
        has_marker = True
        daily_log = DailyLog(user_id=current_user.id, date=date, has_marker=has_marker)
        db.session.add(daily_log)

    db.session.commit()
    return jsonify({"status": "success", "has_marker": has_marker})
