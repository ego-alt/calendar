import re
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_login import current_user

from models import DailyLog, Mood, db

from ._helpers import json_login_required

mood_blueprint = Blueprint("mood", __name__, url_prefix="/mood")

# Different browsers serialize ``rgba(...)`` from getComputedStyle with
# different alpha precision (0.502, 0.501961, 0.5019607843…), so a string-
# exact match against stored Mood rows is fragile. Compare on the RGB triple
# instead — the alpha is constant across the picker so it doesn't disambiguate.
_RGB_TRIPLE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")


def _rgb_triple(color: str | None):
    if not color:
        return None
    m = _RGB_TRIPLE.match(color)
    return tuple(int(x) for x in m.groups()) if m else None


def _find_mood_by_color(color: str) -> Mood | None:
    posted = _rgb_triple(color)
    if posted is None:
        return None
    for candidate in Mood.query.all():
        if _rgb_triple(candidate.color) == posted:
            return candidate
    return None


@mood_blueprint.route("/update", methods=["POST"])
@json_login_required
def update_mood():
    data = request.json
    date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()

    if data["color"] is None and daily_log:
        daily_log.mood_id = None
        if not daily_log.has_marker and not daily_log.attachments:
            db.session.delete(daily_log)
    else:
        mood = _find_mood_by_color(data["color"])
        if mood is None:
            return jsonify({"status": "error", "message": "unknown mood color"}), 400
        if daily_log:
            daily_log.mood_id = mood.id
        else:
            daily_log = DailyLog(user_id=current_user.id, date=date, mood_id=mood.id)
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
        if not daily_log.has_marker and daily_log.mood_id is None and not daily_log.attachments:
            db.session.delete(daily_log)
    else:
        has_marker = True
        daily_log = DailyLog(user_id=current_user.id, date=date, has_marker=has_marker)
        db.session.add(daily_log)

    db.session.commit()
    return jsonify({"status": "success", "has_marker": has_marker})
