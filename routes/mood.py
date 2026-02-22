from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import current_user
from models import db, DailyLog, Mood


mood_blueprint = Blueprint("mood", __name__, url_prefix="/mood")


@mood_blueprint.route("/update", methods=["POST"])
def update_mood():
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    data = request.json
    try:
        date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
        daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

        if data["color"] is None and daily_log:
            daily_log.mood_id = None
            if not daily_log.has_marker:
                db.session.delete(daily_log)
        else:
            mood = Mood.query.filter_by(color=data["color"]).first()
            if daily_log:
                daily_log.mood_id = mood.id
            else:
                daily_log = DailyLog(user_id=current_user.id, date=date, mood_id=mood.id)
                db.session.add(daily_log)

        db.session.commit()
        return jsonify({"status": "success"})

    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@mood_blueprint.route("/marker/toggle", methods=["POST"])
def toggle_marker():
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    data = request.json
    try:
        date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
        daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

        if daily_log:
            has_marker = not daily_log.has_marker
            daily_log.has_marker = has_marker
            if not daily_log.has_marker and daily_log.mood_id is None:
                db.session.delete(daily_log)
        else:
            has_marker = True
            daily_log = DailyLog(user_id=current_user.id, date=date, has_marker=has_marker)
            db.session.add(daily_log)

        db.session.commit()
        return jsonify({"status": "success", "has_marker": has_marker})

    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
