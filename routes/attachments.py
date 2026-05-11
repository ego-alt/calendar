import pathlib
import uuid
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_login import current_user
from werkzeug.utils import secure_filename

from models import Attachment, DailyLog, db

from ._helpers import json_login_required

attachment_blueprint = Blueprint("attachments", __name__, url_prefix="/attachments")


def _attachment_payload(attachment):
    return {
        "id": attachment.id,
        "filename": attachment.original_filename,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
    }


def _get_owned_attachment(attachment_id):
    return (
        Attachment.query.join(DailyLog)
        .filter(Attachment.id == attachment_id, DailyLog.user_id == current_user.id)
        .first()
    )


@attachment_blueprint.route("", methods=["GET"])
@json_login_required
def list_attachments():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    day = int(request.args.get("day"))
    date = datetime(year, month, day).date()

    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()
    attachments = daily_log.attachments if daily_log else []
    return jsonify({
        "status": "success",
        "attachments": [_attachment_payload(a) for a in attachments],
    })


@attachment_blueprint.route("", methods=["POST"])
@json_login_required
def upload_attachment():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"status": "error", "message": "No file provided"}), 400

    year = int(request.form["year"])
    month = int(request.form["month"])
    day = int(request.form["day"])
    date = datetime(year, month, day).date()

    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()
    if daily_log is None:
        daily_log = DailyLog(user_id=current_user.id, date=date)
        db.session.add(daily_log)
        db.session.flush()

    secured = secure_filename(upload.filename) or "attachment"
    ext = pathlib.Path(secured).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{ext}"
    storage_path = pathlib.Path(current_app.config["ATTACHMENT_DIR"]) / stored_name
    upload.save(storage_path)
    size_bytes = storage_path.stat().st_size

    attachment = Attachment(
        daily_log_id=daily_log.id,
        original_filename=upload.filename,
        stored_name=stored_name,
        mime_type=upload.mimetype or "application/octet-stream",
        size_bytes=size_bytes,
    )
    db.session.add(attachment)
    db.session.commit()
    return jsonify({"status": "success", "attachment": _attachment_payload(attachment)})


@attachment_blueprint.route("/<int:attachment_id>", methods=["GET"])
@json_login_required
def download_attachment(attachment_id):
    attachment = _get_owned_attachment(attachment_id)
    if not attachment:
        return jsonify({"status": "error", "message": "Attachment not found"}), 404

    return send_from_directory(
        current_app.config["ATTACHMENT_DIR"],
        attachment.stored_name,
        mimetype=attachment.mime_type,
        download_name=attachment.original_filename,
        as_attachment=False,
    )


@attachment_blueprint.route("/<int:attachment_id>", methods=["DELETE"])
@json_login_required
def delete_attachment(attachment_id):
    attachment = _get_owned_attachment(attachment_id)
    if not attachment:
        return jsonify({"status": "error", "message": "Attachment not found"}), 404

    storage_path = pathlib.Path(current_app.config["ATTACHMENT_DIR"]) / attachment.stored_name
    try:
        storage_path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        current_app.logger.exception("Failed to remove attachment file %s", storage_path)

    daily_log = attachment.daily_log
    db.session.delete(attachment)

    if not daily_log.has_marker and daily_log.mood_id is None and len(daily_log.attachments) <= 1:
        db.session.delete(daily_log)

    db.session.commit()
    return jsonify({"status": "success"})
