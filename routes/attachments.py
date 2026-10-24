import os
import pathlib
import uuid
from datetime import datetime, time, timedelta

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_login import current_user
from sqlalchemy.orm import joinedload
from werkzeug.utils import secure_filename

from models import Attachment, DailyLog, Event, db
from trash import now, purge_deleted

from ._helpers import json_login_required

# Receipts, tickets and photos: images and PDFs only. Anything else could be
# served from this origin and run as the app.
IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
THUMB_SIZE = 480

# Linking a receipt to its entry by time: it can come a little before the entry
# starts (a ticket bought at the door) or a while after it ends (the bill). An
# entry with no end time counts as lasting OPEN_ENDED.
RECEIPT_BEFORE = timedelta(minutes=30)
RECEIPT_AFTER = timedelta(hours=1)
OPEN_ENDED = timedelta(hours=2)


def local_now():
    """Now on the wall clock entries are written in (the TZ setting; the server's own clock without it)."""
    zone = os.environ.get("TZ")
    if zone:
        try:
            from zoneinfo import ZoneInfo
            return datetime.now(ZoneInfo(zone)).replace(tzinfo=None)
        except Exception:  # noqa: BLE001 — an unknown zone falls back to the server's clock
            pass
    return datetime.now()


def _photo_time(path):
    """When a photo says it was taken (EXIF, local time), or None."""
    from PIL import Image

    try:
        with Image.open(path) as img:
            exif = img.getexif()
            stamp = exif.get_ifd(0x8769).get(36867) or exif.get(306)   # DateTimeOriginal, else DateTime
        return datetime.strptime(str(stamp).strip("\x00 "), "%Y:%m:%d %H:%M:%S") if stamp else None
    except Exception:  # noqa: BLE001 — no readable clock
        return None


def taken_at(form, path, is_image, day):
    """When a receipt or photo was taken, on its day, or None:
    what the scanner says ("time" as HH:MM, or "taken_at" as an ISO time), else
    the photo's own clock, else now if it's being added on that day (scanned
    then and there)."""
    candidates = []
    if form.get("taken_at"):
        try:
            candidates.append(datetime.fromisoformat(form["taken_at"]).replace(tzinfo=None))
        except ValueError:
            pass
    if form.get("time"):
        try:
            candidates.append(datetime.combine(day, time.fromisoformat(form["time"])))
        except ValueError:
            pass
    if is_image:
        candidates.append(_photo_time(path))
    candidates.append(local_now())
    return next((t for t in candidates if t and t.date() == day), None)


def _thumb_path(stored_name):
    return pathlib.Path(current_app.config["ATTACHMENT_DIR"]) / "thumbs" / (
        pathlib.Path(stored_name).stem + ".jpg"
    )


def _make_thumb(source, stored_name):
    """A small JPEG preview, turned the right way up (phone photos carry EXIF
    rotation). Returns True if one was written."""
    from PIL import Image, ImageOps

    try:
        with Image.open(source) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((THUMB_SIZE, THUMB_SIZE))
            path = _thumb_path(stored_name)
            path.parent.mkdir(parents=True, exist_ok=True)
            img.convert("RGB").save(path, "JPEG", quality=82)
        return True
    except Exception:  # noqa: BLE001 — a preview is best-effort
        current_app.logger.exception("Couldn't make a thumbnail for %s", stored_name)
        return False


attachment_blueprint = Blueprint("attachments", __name__, url_prefix="/attachments")


def _attachment_payload(attachment):
    return {
        "id": attachment.id,
        "filename": attachment.original_filename,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
        "caption": attachment.caption,
        "event_id": attachment.event_id,
        "taken_at": attachment.taken_at.strftime("%H:%M") if attachment.taken_at else None,
        "is_image": attachment.mime_type.startswith("image/"),
    }


def _get_owned_attachment(attachment_id):
    return (
        Attachment.query.options(
            joinedload(Attachment.daily_log).joinedload(DailyLog.attachments)
        )
        .join(DailyLog)
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

    daily_log = (
        DailyLog.query.options(joinedload(DailyLog.attachments))
        .filter_by(user_id=current_user.id, date=date)
        .first()
    )
    attachments = daily_log.attachments if daily_log else []
    return jsonify({
        "status": "success",
        "attachments": [_attachment_payload(a) for a in attachments],
    })


@attachment_blueprint.route("/month", methods=["GET"])
@json_login_required
def month_attachments():
    """A month's attachments by day of month, for the Diary."""
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    start = datetime(year, month, 1).date()
    end = (datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)).date()
    logs = (
        DailyLog.query.options(joinedload(DailyLog.attachments))
        .filter(DailyLog.user_id == current_user.id, DailyLog.date >= start, DailyLog.date < end)
        .all()
    )
    by_day = {
        log.date.day: [_attachment_payload(a) for a in log.attachments]
        for log in logs
        if log.attachments
    }
    return jsonify({"status": "success", "attachments": by_day})


@attachment_blueprint.route("", methods=["POST"])
@json_login_required
def upload_attachment():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"status": "error", "message": "Choose a file to attach."}), 400

    year = int(request.form["year"])
    month = int(request.form["month"])
    day = int(request.form["day"])
    date = datetime(year, month, day).date()

    daily_log = DailyLog.query.filter_by(user_id=current_user.id, date=date).first()
    if daily_log is None:
        daily_log = DailyLog(user_id=current_user.id, date=date)
        db.session.add(daily_log)
        db.session.flush()

    filename = upload.filename
    secured = secure_filename(filename) or "attachment"
    ext = pathlib.Path(secured).suffix.lower()
    mime = (upload.mimetype or "").lower()
    is_pdf = mime == "application/pdf" or ext == ".pdf"
    is_image = mime in IMAGE_TYPES or ext in IMAGE_EXTS
    if not (is_pdf or is_image):
        db.session.rollback()
        return jsonify({
            "status": "error", "message": "Only photos and PDFs can be attached.",
        }), 415

    folder = pathlib.Path(current_app.config["ATTACHMENT_DIR"])
    stored_name = f"{uuid.uuid4().hex}{'.pdf' if is_pdf else ext}"
    storage_path = folder / stored_name
    upload.save(storage_path)

    if is_image and (ext in {".heic", ".heif"} or mime in {"image/heic", "image/heif"}):
        import pillow_heif

        pillow_heif.register_heif_opener()
    when = taken_at(request.form, storage_path, is_image, date)

    if is_image:
        from PIL import Image

        try:
            # iPhone photos arrive as HEIC, which browsers can't show: keep a JPEG.
            if ext in {".heic", ".heif"} or mime in {"image/heic", "image/heif"}:
                import pillow_heif

                pillow_heif.register_heif_opener()
                jpeg_name = pathlib.Path(stored_name).stem + ".jpg"
                with Image.open(storage_path) as img:
                    img.convert("RGB").save(folder / jpeg_name, "JPEG", quality=90)
                storage_path.unlink(missing_ok=True)
                stored_name, storage_path = jpeg_name, folder / jpeg_name
                filename = str(pathlib.Path(filename).with_suffix(".jpg"))
                mime = "image/jpeg"
            else:
                with Image.open(storage_path) as img:
                    fmt = img.format
                    img.verify()   # it really is an image
                mime = Image.MIME.get(fmt, mime) or mime
        except Exception:  # noqa: BLE001
            storage_path.unlink(missing_ok=True)
            db.session.rollback()
            return jsonify({
                "status": "error", "message": "That photo couldn't be read. Try another format.",
            }), 400
        _make_thumb(storage_path, stored_name)

    attachment = Attachment(
        daily_log_id=daily_log.id,
        original_filename=filename,
        stored_name=stored_name,
        mime_type="application/pdf" if is_pdf else mime,
        size_bytes=storage_path.stat().st_size,
        taken_at=when,
    )
    db.session.add(attachment)
    db.session.commit()
    link_to_entries(current_user.id, [date])
    db.session.refresh(attachment)
    return jsonify({"status": "success", "attachment": _attachment_payload(attachment)})


def link_to_entries(user_id: int, dates) -> int:
    """Each receipt or photo not yet linked goes to its entry: the timed entry
    whose span (from RECEIPT_BEFORE its start to RECEIPT_AFTER its end) holds
    when it was taken; failing that, the day's only entry. Days with several
    entries and nothing to tell them apart are left for you to choose (the
    viewer's entry picker). Returns how many were linked."""
    from sqlalchemy import func

    linked = 0
    for day in dates:
        start = datetime.combine(day, time.min)
        entries = Event.query.filter(
            Event.user_id == user_id,
            Event.start_time < start + timedelta(days=1),
            func.coalesce(Event.end_time, Event.start_time) >= start,
        ).all()
        if not entries:
            continue
        for attachment in (Attachment.query.join(DailyLog)
                           .filter(DailyLog.user_id == user_id, DailyLog.date == day,
                                   Attachment.event_id.is_(None)).all()):
            entry = entry_at(attachment.taken_at, entries) or (entries[0] if len(entries) == 1 else None)
            if entry:
                attachment.event_id = entry.id
                linked += 1
    if linked:
        db.session.commit()
    return linked


def _all_day(entry) -> bool:
    end = entry.end_time
    return entry.start_time.time() == time.min and (end is None or end.strftime("%H:%M") == "23:59")


def entry_at(when, entries):
    """The timed entry a moment belongs to, or None: one whose span (with the
    receipt margins) holds it; inside the entry itself beats the margins, then
    the one that began most recently before it."""
    if when is None:
        return None

    def end(e):
        return e.end_time or e.start_time + OPEN_ENDED
    hits = [e for e in entries if not _all_day(e) and e.start_time - RECEIPT_BEFORE <= when <= end(e) + RECEIPT_AFTER]
    if not hits:
        return None
    return min(hits, key=lambda e: (not (e.start_time <= when <= end(e)), when < e.start_time,
                                    abs((when - e.start_time).total_seconds())))


def _safe_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
    return response


@attachment_blueprint.route("/<int:attachment_id>", methods=["GET"])
@json_login_required
def download_attachment(attachment_id):
    attachment = _get_owned_attachment(attachment_id)
    if not attachment:
        return jsonify({"status": "error", "message": "That file is already gone."}), 404
    mime = attachment.mime_type
    viewable = mime.startswith("image/") or mime == "application/pdf"
    response = send_from_directory(
        current_app.config["ATTACHMENT_DIR"],
        attachment.stored_name,
        mimetype=attachment.mime_type,
        download_name=attachment.original_filename,
        as_attachment=not viewable,   # anything else is a download, never rendered here
        max_age=86400,
    )
    return _safe_headers(response)


@attachment_blueprint.route("/<int:attachment_id>/thumb", methods=["GET"])
@json_login_required
def attachment_thumb(attachment_id):
    attachment = _get_owned_attachment(attachment_id)
    if not attachment or not attachment.mime_type.startswith("image/"):
        return jsonify({"status": "error", "message": "No preview."}), 404
    path = _thumb_path(attachment.stored_name)
    if not path.exists():   # older uploads: make it now
        source = pathlib.Path(current_app.config["ATTACHMENT_DIR"]) / attachment.stored_name
        if not _make_thumb(source, attachment.stored_name):
            return jsonify({"status": "error", "message": "No preview."}), 404
    response = send_from_directory(path.parent, path.name, mimetype="image/jpeg", max_age=86400)
    return _safe_headers(response)


@attachment_blueprint.route("/<int:attachment_id>", methods=["PATCH"])
@json_login_required
def update_attachment(attachment_id):
    """Caption and/or the entry it belongs to (null to unlink)."""
    attachment = _get_owned_attachment(attachment_id)
    if not attachment:
        return jsonify({"status": "error", "message": "That file is already gone."}), 404
    data = request.get_json(silent=True) or {}
    if "caption" in data:
        caption = (data["caption"] or "").strip()
        attachment.caption = caption[:500] or None
    if "event_id" in data:
        event_id = data["event_id"]
        if event_id is not None:
            event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()
            if not event:
                return jsonify({"status": "error", "message": "That entry no longer exists."}), 404
        attachment.event_id = event_id
    db.session.commit()
    return jsonify({"status": "success", "attachment": _attachment_payload(attachment)})


@attachment_blueprint.route("/<int:attachment_id>", methods=["DELETE"])
@json_login_required
def delete_attachment(attachment_id):
    """Soft delete (undoable); the file is removed when it's purged after 30 days."""
    attachment = _get_owned_attachment(attachment_id)
    if not attachment:
        return jsonify({"status": "error", "message": "That file is already gone."}), 404
    attachment.deleted_at = now()
    db.session.commit()
    purge_deleted()
    return jsonify({"status": "success"})


@attachment_blueprint.route("/<int:attachment_id>/restore", methods=["POST"])
@json_login_required
def restore_attachment(attachment_id):
    attachment = (
        Attachment.query.join(DailyLog)
        .filter(Attachment.id == attachment_id, DailyLog.user_id == current_user.id)
        .execution_options(include_deleted=True)
        .first()
    )
    if not attachment:
        return jsonify({"status": "error", "message": "That file can't be brought back."}), 404
    attachment.deleted_at = None
    db.session.commit()
    return jsonify({"status": "success"})
