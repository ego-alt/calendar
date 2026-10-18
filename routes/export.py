"""Download everything: the whole diary as one zip.

  entries.json   every day's mood, marker and note, every entry with its moments
  diary.md       the same as a readable Markdown diary, oldest first
  attachments/   the original files, in a folder per day
"""

import json
import pathlib
import tempfile
import zipfile
from datetime import date

from flask import Blueprint, current_app, send_file
from flask_login import current_user
from sqlalchemy.orm import selectinload

from models import Attachment, DailyLog, Event
from moods import MOOD_BY_KEY

from ._helpers import json_login_required

export_blueprint = Blueprint("export", __name__)


def _entry(e):
    def stamp(dt):
        return dt.strftime("%Y-%m-%d %H:%M") if dt else None

    return {
        "name": e.name, "start": stamp(e.start_time), "end": stamp(e.end_time),
        "with": e.with_who, "where": e.where, "notes": e.notes,
    }


def _moments(e):
    return sorted(e.subevents, key=lambda s: s.start_time)


@export_blueprint.route("/export")
@json_login_required
def export_all():
    uid = current_user.id
    logs = {log.date: log for log in DailyLog.query.filter_by(user_id=uid)}
    events = (
        Event.query.options(selectinload(Event.subevents))
        .filter_by(user_id=uid).order_by(Event.start_time).all()
    )
    attachments = (
        Attachment.query.join(DailyLog).filter(DailyLog.user_id == uid)
        .order_by(DailyLog.date, Attachment.created_at).all()
    )
    files_by_day = {}
    for a in attachments:
        files_by_day.setdefault(a.daily_log.date, []).append(a)

    days = sorted(set(logs) | {e.start_time.date() for e in events} | set(files_by_day))
    entries_by_day = {}
    for e in events:
        entries_by_day.setdefault(e.start_time.date(), []).append(e)

    data = {"exported": date.today().isoformat(), "days": []}
    md = ["# Diary", "", f"Exported {date.today():%-d %b %Y}.", ""]
    folder = pathlib.Path(current_app.config["ATTACHMENT_DIR"])

    tmp = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for d in days:
            log = logs.get(d)
            mood = MOOD_BY_KEY.get(log.mood_key) if log and log.mood_key else None
            day_entries = entries_by_day.get(d, [])
            day_files = files_by_day.get(d, [])
            used = set()
            file_names = []
            for a in day_files:
                name = a.original_filename or a.stored_name
                stem, suffix = pathlib.Path(name).stem, pathlib.Path(name).suffix
                n = 1
                while name in used:   # two files with the same name on one day
                    n += 1
                    name = f"{stem} ({n}){suffix}"
                used.add(name)
                path = folder / a.stored_name
                if path.exists():
                    z.write(path, f"attachments/{d.isoformat()}/{name}")
                arcname = f"attachments/{d.isoformat()}/{name}"
                file_names.append({"file": arcname, "caption": a.caption})
            data["days"].append({
                "date": d.isoformat(),
                "mood": mood.name if mood else None,
                "marked": bool(log and log.has_marker),
                "note": log.note if log else None,
                "entries": [
                    {**_entry(e), "moments": [_entry(s) for s in _moments(e)]}
                    for e in day_entries
                ],
                "attachments": file_names,
            })
            head = f"## {d:%a %-d %b %Y}"
            if mood:
                head += f" · {mood.name}"
            if log and log.has_marker:
                head += " · marked"
            md += [head, ""]
            if log and log.note:
                md += [log.note, ""]
            for e in day_entries:
                md.append(f"### {e.name}")
                bits = [b for b in (e.with_who and f"with {e.with_who}",
                                    e.where and f"at {e.where}") if b]
                if bits:
                    md.append(f"*{' · '.join(bits)}*")
                if e.notes:
                    md += ["", e.notes]
                for s in _moments(e):
                    md.append(f"- **{s.name}**" + (f": {s.notes}" if s.notes else ""))
                md.append("")
            for f in file_names:
                md.append(f"- 📎 [{f['caption'] or pathlib.Path(f['file']).name}]({f['file']})")
            md.append("")
        z.writestr("entries.json", json.dumps(data, ensure_ascii=False, indent=2))
        text = "\n".join(md)
        while "\n\n\n" in text:   # mood-only days leave runs of blank lines
            text = text.replace("\n\n\n", "\n\n")
        z.writestr("diary.md", text)
    tmp.seek(0)
    return send_file(
        tmp, mimetype="application/zip", as_attachment=True,
        download_name=f"diary-{date.today().isoformat()}.zip",
    )
