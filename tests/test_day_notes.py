"""The day's own note: saved on the day, not as an entry; shown in the day,
the diary, the month's folds, search and export; and the converter that turns
old "Daily log" wrapper entries into notes."""
import io
import json
import zipfile

import pytest

import search_index
from day_notes import apply, plan
from models import DailyLog, Event, db
from tests.test_search import stub_embeddings  # noqa: F401  (autouse fixture)

DAY = {"year": 2026, "month": 5, "day": 25}


def _note(client, text, **day):
    r = client.post("/mood/note", json={**DAY, **day, "note": text})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _day(client, day=25):
    return client.get(f"/events?year=2026&month=5&day={day}").get_json()


def test_note_is_saved_on_the_day_not_as_an_entry(authed_client):
    _note(authed_client, "Rain all day. Read on the sofa.")
    day = _day(authed_client)
    assert day["note"] == "Rain all day. Read on the sofa." and day["events"] == []
    assert Event.query.count() == 0


def test_clearing_returns_the_old_text_and_drops_an_empty_day(authed_client, app):
    _note(authed_client, "Something")
    assert _note(authed_client, "   ")["previous"] == "Something"
    assert _day(authed_client)["note"] is None
    assert DailyLog.query.count() == 0          # nothing else was on the day


def test_clearing_the_mood_keeps_a_day_with_a_note(authed_client):
    authed_client.post("/mood/update", json={**DAY, "mood": "good"})
    _note(authed_client, "Kept")
    authed_client.post("/mood/update", json={**DAY, "mood": None})
    assert _day(authed_client)["note"] == "Kept"


def test_note_shows_in_the_month(authed_client):
    _note(authed_client, "x" * 300)
    month = authed_client.get("/events/month?year=2026&month=5").get_json()
    assert month["notes"] == {"25": "x" * 300}
    details = authed_client.get("/get_month?year=2026&month=5").get_json()["day_info"]["25"]
    assert details["note"] is True and details["chars"] == 300


def test_search_finds_a_note_by_its_words(authed_client):
    _note(authed_client, "Massage at Taipei 101, then dumplings")
    results = authed_client.get("/search/data?q=dumplings").get_json()["results"]
    assert [(r["kind"], r["date"]) for r in results] == [("note", "2026-05-25")]


def test_search_with_a_person_filter_skips_notes(authed_client):
    _note(authed_client, "Dumplings with Sam")
    results = authed_client.get("/search/data?q=dumplings&who=Sam").get_json()["results"]
    assert results == []


def test_export_carries_the_note(authed_client):
    _note(authed_client, "Quiet day")
    z = zipfile.ZipFile(io.BytesIO(authed_client.get("/export").data))
    days = json.loads(z.read("entries.json"))["days"]
    assert days[0]["note"] == "Quiet day"
    assert "Quiet day" in z.read("diary.md").decode()


# ---------- converting "Daily log" wrappers ----------

def _wrapper(client, day, **fields):
    r = client.post("/events/", json={"name": "Daily log", "start_date": f"2026-05-{day:02d}",
                                     "end_date": f"2026-05-{day:02d}", **fields})
    return r.get_json()["id"]


def test_converting_daily_logs(authed_client, user):
    plain = _wrapper(authed_client, 3, notes="Lazy Sunday.")
    with_bits = _wrapper(authed_client, 4, notes="Saw the folks.", with_who="Mom", where="Taipei")
    nested = _wrapper(authed_client, 5, notes="Long day.")
    authed_client.post(f"/events/{nested}/subevents", json={
        "name": "Trip to the zoo", "start_date": "2026-05-05", "start_time": "12:00",
        "end_date": "2026-05-05", "end_time": "16:50", "where": "台北動物園"})
    authed_client.post("/events/", json={"name": "Daily log", "start_date": "2026-05-06",
                                        "start_time": "10:00", "end_date": "2026-05-06"})   # not a whole day

    steps, skipped = plan()
    assert [s["day"].day for s in steps] == [3, 4, 5]
    assert [why for _, why in skipped] == ["doesn't cover exactly one whole day"]
    apply(steps)

    assert _day(authed_client, 3)["note"] == "Lazy Sunday." and _day(authed_client, 3)["events"] == []
    assert _day(authed_client, 4)["note"] == "Saw the folks.\n\n+ Mom @ Taipei"
    zoo = _day(authed_client, 5)
    assert zoo["note"] == "Long day."
    assert [(e["name"], e["start_time"], e["where"]) for e in zoo["events"]] == [
        ("Trip to the zoo", "2026-05-05 12:00", "台北動物園")]
    trashed = Event.query.execution_options(include_deleted=True).filter(Event.id.in_([plain, with_bits, nested])).all()
    assert all(e.deleted_at is not None for e in trashed)            # restorable for 30 days
    assert plan()[0] == []                                            # nothing left to convert


@pytest.fixture(autouse=True)
def _fresh_fts(app):
    """FTS tables live outside the ORM; make sure each test starts clean."""
    with app.app_context():
        search_index.ensure_note_fts_table()
        db.session.execute(db.text("DELETE FROM day_note_fts"))
        db.session.commit()
    yield
