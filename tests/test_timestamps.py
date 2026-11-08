"""Times: a moment (made, changed, deleted) is stored as UTC and read back
aware; an entry's own time is a time on the clock as written; and "today" is
the viewer's, from their device's zone."""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import DateTime

from models import db

# Times on the clock as written (12:30 lunch is 12:30 wherever you are).
WALL_CLOCK = {"events.start_time", "events.end_time", "subevents.start_time", "subevents.end_time",
              "attachments.receipt_time"}


def test_every_moment_is_utc():
    plain = {f"{t.name}.{c.name}" for t in db.metadata.tables.values() for c in t.columns
             if isinstance(c.type, DateTime)}
    assert plain == WALL_CLOCK


def _drawn_for(client, zone):
    if zone:
        client.set_cookie("tz", zone)
    page = client.get("/").get_data(as_text=True)
    return page.split('window.SERVER_TODAY = "')[1][:10]


def test_the_page_is_drawn_for_the_viewers_day(authed_client):
    # 25 hours apart: never the same date.
    for zone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):
        assert _drawn_for(authed_client, zone) == datetime.now(ZoneInfo(zone)).date().isoformat()


def test_an_unknown_zone_falls_back_to_utc(authed_client):
    assert _drawn_for(authed_client, "Mars/Olympus") == datetime.now(ZoneInfo("UTC")).date().isoformat()
