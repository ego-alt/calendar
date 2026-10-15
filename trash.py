"""Soft delete and the 30-day purge.

Deleting an entry, a moment or an attachment only stamps `deleted_at`, so the
UI can offer Undo. Anything deleted more than PURGE_AFTER days ago is removed
for good (attachment files included) by `purge_deleted()`, which runs on each
delete and from `flask purge-deleted`.
"""

import pathlib
from datetime import datetime, timedelta

from flask import current_app

from models import Attachment, DailyLog, Event, EventEmbedding, SubEvent, db

PURGE_AFTER = timedelta(days=30)


def now():
    return datetime.utcnow()


def log_has_attachments(log: DailyLog) -> bool:
    """True if the day holds attachments, deleted ones included (they can
    still be restored, so the day record must stay)."""
    return (
        db.session.query(Attachment.id)
        .filter(Attachment.daily_log_id == log.id)
        .execution_options(include_deleted=True)
        .first()
        is not None
    )


def purge_deleted(older_than: timedelta = PURGE_AFTER) -> int:
    """Remove rows soft-deleted before the cutoff. Returns how many went."""
    cutoff = now() - older_than
    removed = 0

    old_events = [
        eid for (eid,) in db.session.query(Event.id)
        .filter(Event.deleted_at.isnot(None), Event.deleted_at < cutoff)
        .execution_options(include_deleted=True)
    ]
    if old_events:
        SubEvent.query.filter(SubEvent.event_id.in_(old_events)).execution_options(
            include_deleted=True
        ).delete(synchronize_session=False)
        EventEmbedding.query.filter(EventEmbedding.event_id.in_(old_events)).delete(
            synchronize_session=False
        )
        removed += Event.query.filter(Event.id.in_(old_events)).execution_options(
            include_deleted=True
        ).delete(synchronize_session=False)

    removed += SubEvent.query.filter(
        SubEvent.deleted_at.isnot(None), SubEvent.deleted_at < cutoff
    ).execution_options(include_deleted=True).delete(synchronize_session=False)

    old_attachments = (
        Attachment.query.filter(Attachment.deleted_at.isnot(None), Attachment.deleted_at < cutoff)
        .execution_options(include_deleted=True)
        .all()
    )
    folder = pathlib.Path(current_app.config["ATTACHMENT_DIR"])
    touched_logs = set()
    for attachment in old_attachments:
        (folder / attachment.stored_name).unlink(missing_ok=True)
        thumb = folder / "thumbs" / (pathlib.Path(attachment.stored_name).stem + ".jpg")
        thumb.unlink(missing_ok=True)
        touched_logs.add(attachment.daily_log_id)
        db.session.delete(attachment)
        removed += 1
    db.session.flush()
    for log_id in touched_logs:   # a day left with nothing on it goes too
        log = db.session.get(DailyLog, log_id)
        if log and log.mood_key is None and not log.has_marker and not log_has_attachments(log):
            db.session.delete(log)

    db.session.commit()
    return removed
