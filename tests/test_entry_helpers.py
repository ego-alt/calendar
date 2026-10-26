"""Entries doing the obvious thing: a receipt joins the entry its time falls in, a moment
dated outside its entry stretches it, and names you've used before come back
with their usual place and people."""
from tests.test_api_endpoints import _entry
from tests.test_routes import _upload


def _day_attachments(client, y, m, d):
    return client.get(f"/attachments?year={y}&month={m}&day={d}").get_json()["attachments"]


# ---------- receipts ----------

def _receipt(client, y, m, d, when=None):
    from io import BytesIO

    from tests.test_routes import _png
    data = {"year": y, "month": m, "day": d, "file": (BytesIO(_png()), "r.png", "image/png")}
    if when:
        data["time"] = when
    return client.post("/attachments", data=data, content_type="multipart/form-data")


def test_a_receipt_without_a_time_stays_on_its_day(authed_client):
    _entry(authed_client, start_date="2026-05-11", end_date="2026-05-11", start_time="09:00", end_time="17:00")
    _upload(authed_client, 2026, 5, 11)
    assert [a["event_id"] for a in _day_attachments(authed_client, 2026, 5, 11)] == [None]


def test_a_timed_receipt_doesnt_join_an_all_day_entry(authed_client):
    _entry(authed_client, start_date="2026-05-12", end_date="2026-05-12", start_time="", end_time="")
    _receipt(authed_client, 2026, 5, 12, "13:00")
    assert [a["event_id"] for a in _day_attachments(authed_client, 2026, 5, 12)] == [None]


def test_receipts_scanned_first_join_the_entry_written_later(authed_client):
    _receipt(authed_client, 2026, 5, 13, "20:30")
    _upload(authed_client, 2026, 5, 13)                                   # no time: stays on the day
    eid = _entry(authed_client, name="Dinner", start_date="2026-05-13", start_time="19:30",
                 end_date="2026-05-13", end_time="22:00")
    assert sorted(a["event_id"] or 0 for a in _day_attachments(authed_client, 2026, 5, 13)) == [0, eid]


# ---------- moments outside their entry ----------

def test_moment_on_the_next_day_stretches_an_all_day_entry(authed_client):
    eid = _entry(authed_client, name="Daily log", start_date="2026-05-25", start_time="", end_date="2026-05-25", end_time="")
    r = authed_client.post(f"/events/{eid}/subevents", json={
        "name": "A&E visit", "start_date": "2026-05-26", "start_time": "19:00",
        "end_date": "2026-05-26", "end_time": "21:30"})
    assert r.status_code == 200
    assert r.get_json()["stretched"] == "“Daily log” now runs Mon 25 – Tue 26 May."
    event = authed_client.get(f"/events/{eid}").get_json()["event"]
    assert (event["start_time"], event["end_time"]) == ("2026-05-25 00:00", "2026-05-26 23:59")   # still all-day


def test_moving_a_moment_earlier_stretches_a_timed_entry(authed_client):
    eid = _entry(authed_client)            # 10 Mar 19:00–21:00
    sub = authed_client.post(f"/events/{eid}/subevents", json={
        "name": "Ramen", "start_date": "2026-03-10", "start_time": "19:30",
        "end_date": "2026-03-10", "end_time": "20:00"}).get_json()["id"]
    r = authed_client.put(f"/events/subevents/{sub}", json={
        "name": "Ramen", "start_date": "2026-03-10", "start_time": "18:00",
        "end_date": "2026-03-10", "end_time": "18:30"})
    assert r.get_json()["stretched"] == "“Dinner” now runs Tue 10 Mar."
    assert authed_client.get(f"/events/{eid}").get_json()["event"]["start_time"] == "2026-03-10 18:00"


def test_a_moment_without_times_on_its_entrys_day_keeps_the_entrys_hours(authed_client):
    eid = _entry(authed_client)            # 10 Mar 19:00–21:00
    r = authed_client.post(f"/events/{eid}/subevents", json={
        "name": "Dessert", "start_date": "2026-03-10", "start_time": "", "end_date": "2026-03-10", "end_time": ""})
    assert r.get_json()["stretched"] is None
    event = authed_client.get(f"/events/{eid}").get_json()["event"]
    assert (event["start_time"], event["end_time"]) == ("2026-03-10 19:00", "2026-03-10 21:00")


def test_a_moment_inside_its_entry_changes_nothing(authed_client):
    eid = _entry(authed_client)
    r = authed_client.post(f"/events/{eid}/subevents", json={
        "name": "Ramen", "start_date": "2026-03-10", "start_time": "19:30",
        "end_date": "2026-03-10", "end_time": "20:00"})
    assert r.get_json()["stretched"] is None


# ---------- names you've used before ----------

def test_suggestions_carry_the_usual_place_and_people(authed_client):
    for day, who in (("01", "Alex"), ("08", "Sam"), ("15", "Alex")):
        _entry(authed_client, name="Bouldering", where="Bethwall", with_who=who,
               start_date=f"2026-04-{day}", end_date=f"2026-04-{day}")
    for day, where in (("02", "Soho"), ("09", "Hackney")):
        _entry(authed_client, name="Hangout", where=where, start_date=f"2026-04-{day}", end_date=f"2026-04-{day}")
    _entry(authed_client, name="Once", start_date="2026-04-03", end_date="2026-04-03")
    got = {s["name"]: s for s in authed_client.get("/events/suggestions").get_json()["suggestions"]}
    assert set(got) == {"Bouldering", "Hangout"}                       # used once: not offered
    assert (got["Bouldering"]["where"], got["Bouldering"]["with_who"], got["Bouldering"]["count"]) == ("Bethwall", "Alex", 3)
    assert got["Hangout"]["where"] == ""                                  # no usual place
    assert list(got) == ["Bouldering", "Hangout"]                         # most used first
