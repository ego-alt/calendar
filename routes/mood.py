from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_login import current_user

from models import DailyLog, db
from moods import MOOD_BY_KEY
from search_index import index_day_note_safe
from trash import log_is_empty

from ._helpers import json_login_required

mood_blueprint = Blueprint("mood", __name__, url_prefix="/mood")


@mood_blueprint.route("/update", methods=["POST"])
@json_login_required
def update_mood():
    data = request.json
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()
    previous = daily_log.mood_key if daily_log else None

    key = data.get("mood")
    if key is None:
        if daily_log:
            daily_log.mood_key = None
            if log_is_empty(daily_log):
                db.session.delete(daily_log)
    else:
        if key not in MOOD_BY_KEY:
            return jsonify({"status": "error", "message": "That mood isn't one of the five."}), 400
        if daily_log:
            daily_log.mood_key = key
        else:
            daily_log = DailyLog(user_id=current_user.id, date=date, mood_key=key)
            db.session.add(daily_log)

    db.session.commit()
    return jsonify({"status": "success", "previous": previous})


@mood_blueprint.route("/marker/toggle", methods=["POST"])
@json_login_required
def toggle_marker():
    data = request.json
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

    if daily_log:
        has_marker = not daily_log.has_marker
        daily_log.has_marker = has_marker
        if log_is_empty(daily_log):
            db.session.delete(daily_log)
    else:
        has_marker = True
        daily_log = DailyLog(user_id=current_user.id, date=date, has_marker=has_marker)
        db.session.add(daily_log)

    db.session.commit()
    return jsonify({"status": "success", "has_marker": has_marker})


@mood_blueprint.route("/note", methods=["POST"])
@json_login_required
def update_note():
    """The day's own note: free text, saved as you type. An empty note clears
    it. Returns the previous text so the app can offer Undo."""
    data = request.json or {}
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    note = (data.get("note") or "").strip() or None
    if note and len(note) > 20000:
        return jsonify({"status": "error", "message": "That note is too long to save."}), 400
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()
    previous = daily_log.note if daily_log else None
    if daily_log is None:
        if note is None:
            return jsonify({"status": "success", "previous": None})
        daily_log = DailyLog(user_id=current_user.id, date=date)
        db.session.add(daily_log)
    daily_log.note = note
    db.session.flush()
    log_id = daily_log.id
    if log_is_empty(daily_log):
        db.session.delete(daily_log)
    db.session.commit()
    index_day_note_safe(log_id)
    return jsonify({"status": "success", "previous": previous})
