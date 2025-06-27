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

        # If color is null, delete the daily log if it exists
        if data["color"] is None and daily_log:
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
