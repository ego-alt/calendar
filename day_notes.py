"""Turn "Daily log" wrapper entries into day notes.

A "Daily log" was a whole-day entry used only to write about the day. Each one
becomes that day's note: its notes, plus a "+ people @ place" line if it had
either. Moments inside it were real happenings, so they become ordinary
entries on the day. Photos linked to it go back to the day (and on to its only
entry, if it now has exactly one). The wrapper goes to the trash, restorable
for 30 days.

Run `flask convert-daily-logs` to preview, `--apply` to do it.
"""
from datetime import time

from models import Attachment, DailyLog, Event, db
from search_index import index_day_note, index_event, remove_event
from trash import now


def _is_wrapper(event: Event) -> bool:
    end = event.end_time or event.start_time
    return (
        event.name.strip().lower() == "daily log"
        and event.start_time.time() == time(0, 0)
        and end.strftime("%H:%M") == "23:59"
        and end.date() == event.start_time.date()
    )


def _note_text(event: Event) -> str:
    text = (event.notes or "").strip()
    tail = " ".join(p for p in (
        f"+ {event.with_who.strip()}" if (event.with_who or "").strip() else "",
        f"@ {event.where.strip()}" if (event.where or "").strip() else "",
    ) if p)
    return "\n\n".join(p for p in (text, tail) if p)


def plan(user_id=None):
    """What converting would do: one dict per wrapper, plus skipped ones."""
    query = Event.query.filter(db.func.lower(db.func.trim(Event.name)) == "daily log")
    if user_id:
        query = query.filter(Event.user_id == user_id)
    steps, skipped = [], []
    for event in query.order_by(Event.start_time).all():
        if not _is_wrapper(event):
            skipped.append((event, "doesn't cover exactly one whole day"))
            continue
        day = event.start_time.date()
        log = DailyLog.query.filter_by(user_id=event.user_id, date=day).first()
        if log and (log.note or "").strip():
            skipped.append((event, "that day already has a note"))
            continue
        moments = sorted((s for s in event.subevents if s.deleted_at is None), key=lambda s: s.start_time)
        photos = Attachment.query.filter_by(event_id=event.id).all()
        steps.append({"event": event, "day": day, "note": _note_text(event), "moments": moments, "photos": photos})
    return steps, skipped


def apply(steps):
    from routes.attachments import link_to_lone_entry

    for step in steps:
        event, day = step["event"], step["day"]
        log = DailyLog.query.filter_by(user_id=event.user_id, date=day).first()
        if log is None:
            log = DailyLog(user_id=event.user_id, date=day)
            db.session.add(log)
        log.note = step["note"] or None
        new_entries = []
        for s in step["moments"]:
            entry = Event(user_id=event.user_id, name=s.name, notes=s.notes, with_who=s.with_who,
                          where=s.where, start_time=s.start_time, end_time=s.end_time,
                          created_at=s.created_at)
            db.session.add(entry)
            new_entries.append(entry)
        for a in step["photos"]:
            a.event_id = None
        event.deleted_at = now()
        db.session.commit()
        remove_event(event.id)
        for entry in new_entries:
            index_event(entry)
        index_day_note(log.id)
        link_to_lone_entry(event.user_id, [day])
