import pathlib
from io import BytesIO

from werkzeug.security import generate_password_hash

from models import Attachment, User, db


def test_index_anonymous(client):
    assert client.get("/").status_code == 200


def test_index_anonymous_shows_sign_in(client):
    html = client.get("/").get_data(as_text=True)
    assert "signed-out" in html and "Sign in" in html


def test_calendar_data_requires_sign_in(client):
    for url in ("/get_month?year=2026&month=5", "/get_year?year=2026"):
        response = client.get(url)
        assert response.status_code == 401 and response.json["message"] == "Please sign in again."


def test_get_month_signed_in(authed_client):
    body = authed_client.get("/get_month?year=2026&month=5").get_json()
    assert body["month_label"] == "May 2026"
    assert len(authed_client.get("/get_year?year=2026").get_json()["months"]) == 12


def test_first_run_card_until_something_is_logged(authed_client):
    assert 'id="firstRun"' in authed_client.get("/").get_data(as_text=True)
    authed_client.post("/mood/update", json={"year": 2026, "month": 5, "day": 1, "mood": "good"})
    assert 'id="firstRun"' not in authed_client.get("/").get_data(as_text=True)


def test_events_requires_auth(client):
    response = client.get("/events?year=2026&month=5&day=11")
    assert response.status_code == 401


def test_login_rejects_bad_password(client, user):
    response = client.post("/auth/login", data={"username": "grey", "password": "wrong"})
    assert response.status_code == 401


def test_event_crud(authed_client):
    create = authed_client.post("/events", json={
        "name": "Coffee",
        "start_date": "2026-05-11",
        "start_time": "14:00",
        "end_date": "2026-05-11",
        "end_time": "15:00",
        "where": "Blue Bottle",
        "with_who": "Sam",
        "notes": "monthly catch-up",
    })
    assert create.status_code == 200

    listed = authed_client.get("/events?year=2026&month=5&day=11").get_json()
    assert len(listed["events"]) == 1
    event = listed["events"][0]
    assert event["name"] == "Coffee"
    assert event["where"] == "Blue Bottle"

    skip = {"id", "subevents", "start_time", "end_time"}
    updated = authed_client.put(f"/events/{event['id']}", json={
        **{k: v for k, v in event.items() if k not in skip},
        "name": "Coffee with Sam",
        "start_date": "2026-05-11",
        "start_time": "14:30",
        "end_date": "2026-05-11",
        "end_time": "15:30",
    })
    assert updated.status_code == 200
    refreshed = authed_client.get("/events?year=2026&month=5&day=11").get_json()
    assert refreshed["events"][0]["name"] == "Coffee with Sam"

    deleted = authed_client.delete(f"/events/{event['id']}")
    assert deleted.status_code == 200
    assert authed_client.get("/events?year=2026&month=5&day=11").get_json()["events"] == []


def test_subevent_crud(authed_client):
    parent = authed_client.post("/events", json={
        "name": "Conference",
        "start_date": "2026-05-11",
        "start_time": "09:00",
        "end_date": "2026-05-11",
        "end_time": "17:00",
    })
    assert parent.status_code == 200
    parent_id = authed_client.get("/events?year=2026&month=5&day=11").get_json()["events"][0]["id"]

    sub = authed_client.post(f"/events/{parent_id}/subevents", json={
        "name": "Opening keynote",
        "start_date": "2026-05-11",
        "start_time": "09:30",
        "end_date": "2026-05-11",
        "end_time": "10:30",
    })
    assert sub.status_code == 200

    listing = authed_client.get("/events?year=2026&month=5&day=11").get_json()
    sub_id = listing["events"][0]["subevents"][0]["id"]

    # A moment dated outside its entry stretches the entry rather than failing.
    later = authed_client.post(f"/events/{parent_id}/subevents", json={
        "name": "After party",
        "start_date": "2026-05-12",
        "start_time": "20:00",
        "end_date": "2026-05-12",
        "end_time": "23:00",
    })
    assert later.status_code == 200 and "now runs" in later.get_json()["stretched"]

    deleted = authed_client.delete(f"/events/subevents/{sub_id}")
    assert deleted.status_code == 200


def test_mood_update_and_marker(authed_client):
    update = authed_client.post("/mood/update", json={
        "year": 2026, "month": 5, "day": 11, "mood": "great",
    })
    assert update.status_code == 200

    month = authed_client.get("/get_month?year=2026&month=5").get_json()
    from moods import MOOD_BY_KEY
    assert month["mood_colors"]["11"] == MOOD_BY_KEY["great"].color

    toggle = authed_client.post("/mood/marker/toggle", json={
        "year": 2026, "month": 5, "day": 11,
    })
    assert toggle.status_code == 200
    assert toggle.get_json()["has_marker"] is True
    assert 11 in authed_client.get("/get_month?year=2026&month=5").get_json()["days_with_marker"]


def _png(size=(40, 30)):
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", size, (200, 180, 160)).save(buf, "PNG")
    return buf.getvalue()


def _upload(
    client, year, month, day,
    *, filename="receipt.png", mime="image/png", content=None,
):
    if content is None:
        content = _png()
    return client.post(
        "/attachments",
        data={
            "year": year, "month": month, "day": day,
            "file": (BytesIO(content), filename, mime),
        },
        content_type="multipart/form-data",
    )


def test_attachment_upload_and_list(authed_client):
    response = _upload(authed_client, 2026, 5, 11)
    assert response.status_code == 200
    payload = response.get_json()["attachment"]
    assert payload["filename"] == "receipt.png"
    assert payload["mime_type"] == "image/png"
    assert payload["size_bytes"] == len(_png())

    listed = authed_client.get("/attachments?year=2026&month=5&day=11").get_json()
    assert len(listed["attachments"]) == 1
    assert listed["attachments"][0]["filename"] == "receipt.png"


def test_attachment_download_serves_bytes(authed_client):
    content = _png((12, 9))
    upload = _upload(authed_client, 2026, 5, 11, content=content)
    attachment_id = upload.get_json()["attachment"]["id"]

    response = authed_client.get(f"/attachments/{attachment_id}")
    assert response.status_code == 200
    assert response.data == content
    assert response.headers["Content-Type"].startswith("image/png")


def test_attachment_delete_is_undoable_then_purged(authed_client, app):
    upload = _upload(authed_client, 2026, 5, 11)
    attachment_id = upload.get_json()["attachment"]["id"]

    with app.app_context():
        stored_name = db.session.get(Attachment, attachment_id).stored_name
    file_path = pathlib.Path(app.config["ATTACHMENT_DIR"]) / stored_name
    assert file_path.exists()

    deleted = authed_client.delete(f"/attachments/{attachment_id}")
    assert deleted.status_code == 200
    after = authed_client.get("/attachments?year=2026&month=5&day=11").get_json()
    assert after["attachments"] == []
    assert file_path.exists()                      # kept so Undo can restore it

    assert authed_client.post(f"/attachments/{attachment_id}/restore").status_code == 200
    back = authed_client.get("/attachments?year=2026&month=5&day=11").get_json()
    assert [a["id"] for a in back["attachments"]] == [attachment_id]

    authed_client.delete(f"/attachments/{attachment_id}")
    with app.app_context():
        from datetime import timedelta

        from trash import purge_deleted
        assert purge_deleted(older_than=timedelta(0)) == 1
    assert not file_path.exists()


def test_attachment_ownership_blocks_other_user(authed_client, app, client):
    upload = _upload(authed_client, 2026, 5, 11)
    attachment_id = upload.get_json()["attachment"]["id"]

    with app.app_context():
        db.session.add(User(username="mallory", password_hash=generate_password_hash("pw")))
        db.session.commit()

    other = app.test_client()
    other.post("/auth/login", data={"username": "mallory", "password": "pw"})
    assert other.get(f"/attachments/{attachment_id}").status_code == 404
    assert other.delete(f"/attachments/{attachment_id}").status_code == 404


def test_clearing_mood_keeps_daily_log_when_attachment_present(authed_client, app):
    authed_client.post("/mood/update", json={
        "year": 2026, "month": 5, "day": 11, "color": "rgb(46, 204, 113)",
    })
    _upload(authed_client, 2026, 5, 11)
    cleared = authed_client.post("/mood/update", json={
        "year": 2026, "month": 5, "day": 11, "color": None,
    })
    assert cleared.status_code == 200
    listed = authed_client.get("/attachments?year=2026&month=5&day=11").get_json()
    assert len(listed["attachments"]) == 1


def test_entry_validation_messages(authed_client):
    """Bad entries get a 400 with a message fit to show the user."""
    base = {"name": "Walk", "start_date": "2026-10-10", "end_date": "2026-10-10"}
    r = authed_client.post("/events/", json={**base, "name": "  "})
    assert r.status_code == 400 and r.json["message"] == "Give this entry a name."
    r = authed_client.post("/events/", json={**base, "start_time": "18:00", "end_time": "09:00"})
    assert r.status_code == 400 and r.json["message"] == "The end is before the start."
    r = authed_client.post("/events/", json={**base, "start_date": "10/10/2026"})
    assert r.status_code == 400 and "doesn't look right" in r.json["message"]
    r = authed_client.post("/events/", json={**base, "start_date": "10-10-2026"})
    assert r.status_code == 400 and "doesn't look right" in r.json["message"]
    assert authed_client.post("/events/", json=base).status_code == 200


def test_editing_an_entry_cannot_strand_its_moments(authed_client):
    trip = {"name": "Trip", "start_date": "2026-10-03", "end_date": "2026-10-05"}
    authed_client.post("/events/", json=trip)
    event = authed_client.get("/events/?year=2026&month=10&day=3").json["events"][0]
    authed_client.post(f"/events/{event['id']}/subevents", json={
        "name": "Hike", "start_date": "2026-10-04", "start_time": "10:00",
        "end_date": "2026-10-04", "end_time": "12:00"})
    shorter = {**trip, "end_date": "2026-10-03"}
    r = authed_client.put(f"/events/{event['id']}", json=shorter)
    assert r.status_code == 400 and "Hike" in r.json["message"]


def test_oversized_upload_says_so(authed_client, app):
    app.config["MAX_CONTENT_LENGTH"] = 1024
    import io
    form = {"year": "2026", "month": "10", "day": "6",
            "file": (io.BytesIO(b"0" * 4096), "big.jpg")}
    r = authed_client.post("/attachments", data=form, content_type="multipart/form-data")
    assert r.status_code == 413
    assert r.json["message"].startswith("That file is over")


def test_day_carries_mood_and_marker_and_undo_info(authed_client):
    day = {"year": 2026, "month": 10, "day": 7}
    r = authed_client.post("/mood/update", json={**day, "mood": "good"})
    assert r.json["previous"] is None
    r = authed_client.post("/mood/update", json={**day, "mood": "low"})
    assert r.json["previous"] == "good"          # what Undo restores
    authed_client.post("/mood/marker/toggle", json=day)
    got = authed_client.get("/events/?year=2026&month=10&day=7").json
    assert got["mood"] == "low" and got["has_marker"] is True
    r = authed_client.post("/mood/update", json={**day, "mood": "meh"})
    assert r.status_code == 400 and "five" in r.json["message"]



def test_delete_entry_is_undoable_and_hidden_everywhere(authed_client, app):
    authed_client.post("/events/", json={"name": "Trip", "start_date": "2026-10-03",
                                         "end_date": "2026-10-05", "notes": "midges"})
    event = authed_client.get("/events/?year=2026&month=10&day=3").json["events"][0]
    authed_client.post(f"/events/{event['id']}/subevents", json={
        "name": "Hike", "start_date": "2026-10-04", "end_date": "2026-10-04"})
    assert authed_client.delete(f"/events/{event['id']}").status_code == 200
    assert authed_client.get("/events/?year=2026&month=10&day=3").json["events"] == []
    assert authed_client.get("/get_month?year=2026&month=10").json["days_with_events"] == []
    assert authed_client.get("/events/month?year=2026&month=10").json["events"] == []

    assert authed_client.post(f"/events/{event['id']}/restore").status_code == 200
    back = authed_client.get("/events/?year=2026&month=10&day=4").json["events"]
    assert [e["name"] for e in back] == ["Trip"] and back[0]["subevents"][0]["name"] == "Hike"


def test_delete_moment_is_undoable(authed_client):
    authed_client.post("/events/", json={"name": "Day", "start_date": "2026-10-03",
                                         "end_date": "2026-10-03"})
    event = authed_client.get("/events/?year=2026&month=10&day=3").json["events"][0]
    authed_client.post(f"/events/{event['id']}/subevents", json={
        "name": "Lunch", "start_date": "2026-10-03", "end_date": "2026-10-03"})
    sub = authed_client.get("/events/?year=2026&month=10&day=3").json["events"][0]["subevents"][0]
    authed_client.delete(f"/events/subevents/{sub['id']}")
    day = authed_client.get("/events/?year=2026&month=10&day=3").json
    assert day["events"][0]["subevents"] == []
    authed_client.post(f"/events/subevents/{sub['id']}/restore")
    subs = authed_client.get("/events/?year=2026&month=10&day=3").json["events"][0]["subevents"]
    assert [s["name"] for s in subs] == ["Lunch"]


def test_clearing_mood_keeps_a_day_with_only_deleted_attachments(authed_client, app):
    """The day record must survive so a deleted attachment can still be restored."""
    upload = _upload(authed_client, 2026, 5, 12)
    attachment_id = upload.get_json()["attachment"]["id"]
    authed_client.post("/mood/update", json={"year": 2026, "month": 5, "day": 12, "mood": "good"})
    authed_client.delete(f"/attachments/{attachment_id}")
    authed_client.post("/mood/update", json={"year": 2026, "month": 5, "day": 12, "mood": None})
    assert authed_client.post(f"/attachments/{attachment_id}/restore").status_code == 200


def test_streak_counts_from_yesterday_until_today_is_logged(authed_client):
    from datetime import date, timedelta
    today = date.today()
    for back in (1, 2, 3):
        d = today - timedelta(days=back)
        authed_client.post("/mood/update", json={"year": d.year, "month": d.month, "day": d.day,
                                                 "mood": "okay"})
    tiles = authed_client.get("/stats/data").json["tiles"]
    assert tiles["current_streak"] == 3 and tiles["today_logged"] is False
    authed_client.post("/mood/update", json={"year": today.year, "month": today.month,
                                             "day": today.day, "mood": "good"})
    tiles = authed_client.get("/stats/data").json["tiles"]
    assert tiles["current_streak"] == 4 and tiles["today_logged"] is True


def test_month_attachments_by_day(authed_client):
    _upload(authed_client, 2026, 5, 11)
    _upload(authed_client, 2026, 5, 20)
    got = authed_client.get("/attachments/month?year=2026&month=5").json["attachments"]
    assert sorted(got) == ["11", "20"] and got["11"][0]["filename"]



def test_only_photos_and_pdfs_are_accepted(authed_client):
    r = _upload(authed_client, 2026, 5, 11, filename="page.html", mime="text/html",
                content=b"<script>alert(1)</script>")
    assert r.status_code == 415 and "photos and PDFs" in r.json["message"]
    r = _upload(authed_client, 2026, 5, 11, filename="fake.png", mime="image/png",
                content=b"not really a png")
    assert r.status_code == 400
    r = _upload(authed_client, 2026, 5, 11, filename="ticket.pdf", mime="application/pdf",
                content=b"%PDF-1.4 minimal")
    assert r.status_code == 200 and r.json["attachment"]["is_image"] is False


def test_heic_becomes_jpeg_with_a_thumbnail(authed_client):
    import pillow_heif
    from PIL import Image
    pillow_heif.register_heif_opener()
    buf = BytesIO()
    Image.new("RGB", (900, 1200), (90, 120, 160)).save(buf, "HEIF")
    r = _upload(authed_client, 2026, 5, 13, filename="IMG_4021.HEIC", mime="image/heic",
                content=buf.getvalue())
    att = r.json["attachment"]
    assert att["filename"] == "IMG_4021.jpg" and att["mime_type"] == "image/jpeg"
    full = authed_client.get(f"/attachments/{att['id']}")
    assert full.headers["Content-Type"] == "image/jpeg"
    assert full.headers["X-Content-Type-Options"] == "nosniff"
    thumb = authed_client.get(f"/attachments/{att['id']}/thumb")
    assert thumb.status_code == 200
    assert max(Image.open(BytesIO(thumb.data)).size) <= 480


def test_caption_and_link_to_entry(authed_client):
    authed_client.post("/events/", json={"name": "Concert", "start_date": "2026-05-11",
                                         "end_date": "2026-05-11"})
    event_id = authed_client.get("/events/?year=2026&month=5&day=11").json["events"][0]["id"]
    att_id = _upload(authed_client, 2026, 5, 11).json["attachment"]["id"]
    r = authed_client.patch(f"/attachments/{att_id}",
                            json={"caption": " Ticket ", "event_id": event_id})
    updated = r.json["attachment"]
    assert updated["caption"] == "Ticket" and updated["event_id"] == event_id
    listed = authed_client.get("/attachments?year=2026&month=5&day=11").json["attachments"][0]
    assert listed["caption"] == "Ticket" and listed["event_id"] == event_id
    r = authed_client.patch(f"/attachments/{att_id}", json={"event_id": None})
    assert r.json["attachment"]["event_id"] is None


def test_mood_with_people_and_places(authed_client):
    """Days with Sam are 'great', days with Lea 'low': each set against the overall average."""
    from datetime import date, timedelta
    today = date.today()
    for i in range(1, 7):
        d = today - timedelta(days=i)
        sam = i <= 3
        authed_client.post("/mood/update", json={"year": d.year, "month": d.month, "day": d.day,
                                                 "mood": "great" if sam else "low"})
        authed_client.post("/events/", json={
            "name": "Walk", "start_date": d.isoformat(), "end_date": d.isoformat(),
            "with_who": "Sam" if sam else "Lea, Jonas", "where": "Leith" if sam else "Home"})
    mw = authed_client.get("/stats/data").json["mood_with"]
    assert mw["overall"] == 3.5
    people = {p["name"]: p for p in mw["people"]}
    sam = people["Sam"]
    assert sam["avg"] == 5 and sam["delta"] == 1.5 and sam["days"] == 3
    assert people["Lea"]["delta"] == -1.5 and people["Jonas"]["days"] == 3
    assert [p["name"] for p in mw["places"]] == ["Leith", "Home"]


def test_stats_for_a_past_year(authed_client):
    authed_client.post("/mood/update", json={"year": 2024, "month": 3, "day": 5, "mood": "good"})
    data = authed_client.get("/stats/data?year=2024").json
    assert data["range_start"] == "2024-01-01" and data["range_end"] == "2024-12-31"
    assert data["tiles"]["logged"] == 1 and data["tiles"]["current_streak"] is None
    assert 2024 in data["years"] and [m["label"] for m in data["month_mix"]][0] == "Jan"


def test_export_everything(authed_client):
    import json
    import zipfile
    authed_client.post("/events/", json={"name": "Concert", "start_date": "2026-05-11",
                                         "end_date": "2026-05-11", "with_who": "Sam",
                                         "notes": "Loud."})
    authed_client.post("/mood/update", json={"year": 2026, "month": 5, "day": 11, "mood": "great"})
    _upload(authed_client, 2026, 5, 11, filename="ticket.png")
    _upload(authed_client, 2026, 5, 11, filename="ticket.png")   # same name twice
    r = authed_client.get("/export")
    assert r.status_code == 200 and r.headers["Content-Type"] == "application/zip"
    z = zipfile.ZipFile(BytesIO(r.data))
    names = set(z.namelist())
    assert {"entries.json", "diary.md", "attachments/2026-05-11/ticket.png",
            "attachments/2026-05-11/ticket (2).png"} <= names
    day = json.loads(z.read("entries.json"))["days"][0]
    assert day["mood"] == "Great" and day["entries"][0]["name"] == "Concert"
    assert "## Mon 11 May 2026 · Great" in z.read("diary.md").decode()


def test_month_day_info(authed_client):
    authed_client.post("/events/", json={"name": "Trip", "start_date": "2026-05-03",
                                         "end_date": "2026-05-04", "notes": "x" * 300})
    _upload(authed_client, 2026, 5, 4)
    info = authed_client.get("/get_month?year=2026&month=5").json["day_info"]
    assert info["3"]["entries"] == 1 and info["3"]["chars"] == 304
    assert info["4"]["attachments"] == 1 and "5" not in info


def test_static_urls_are_versioned(authed_client):
    html = authed_client.get("/").get_data(as_text=True)
    assert "static/js/day.js?v=" in html and "static/css/index.css?v=" in html


def _jpeg_taken(when):
    """A JPEG whose EXIF says when it was taken."""
    from PIL import Image

    img, exif = Image.new("RGB", (4, 4), "white"), Image.Exif()
    exif.get_ifd(0x8769)[36867] = when
    out = BytesIO()
    img.save(out, "JPEG", exif=exif)
    return out.getvalue()


def test_receipts_go_to_the_entry_they_were_taken_in(authed_client):
    """Two entries on a day: a receipt goes to the one whose time holds it (or
    an hour after it ends: the bill), whether it says so, its photo does, or
    the entry is written afterwards. One taken at neither stays for you."""
    for name, start, end in (("Lunch", "12:30", "13:30"), ("Dinner", "19:00", "21:00")):
        authed_client.post("/events/", json={"name": name, "start_date": "2026-05-11", "start_time": start,
                                             "end_date": "2026-05-11", "end_time": end})
    events = {e["name"]: e["id"] for e in authed_client.get("/events/?year=2026&month=5&day=11").json["events"]}

    def upload(**extra):
        data = {"year": 2026, "month": 5, "day": 11, **extra}
        data.setdefault("file", (BytesIO(_png()), "receipt.png", "image/png"))
        return authed_client.post("/attachments", data=data, content_type="multipart/form-data").json["attachment"]

    assert upload(time="21:40")["event_id"] == events["Dinner"]             # the bill, after it ended
    photo = upload(file=(BytesIO(_jpeg_taken("2026:05:11 12:45:00")), "IMG_1.jpg", "image/jpeg"))
    assert photo["event_id"] == events["Lunch"] and photo["taken_at"] == "12:45"
    assert upload(time="16:00")["event_id"] is None                          # between the two: yours to choose
    assert upload(taken_at="2026-05-11T19:05:00")["event_id"] == events["Dinner"]

    # Written afterwards: a receipt already there joins the entry its time falls in.
    loose = upload(time="09:10")
    assert loose["event_id"] is None
    authed_client.post("/events/", json={"name": "Breakfast", "start_date": "2026-05-11", "start_time": "09:00",
                                         "end_date": "2026-05-11", "end_time": "09:45"})
    listed = {a["id"]: a for a in authed_client.get("/attachments?year=2026&month=5&day=11").json["attachments"]}
    assert listed[loose["id"]]["event_id"] not in (None, events["Lunch"], events["Dinner"])


def test_a_receipt_scanned_later_isnt_given_that_time(authed_client, monkeypatch):
    """Added on another day with no time of its own: no time, so the day's only
    entry still takes it, but no guess is made from when it was added."""
    import routes.attachments as attachments
    from datetime import datetime as real

    monkeypatch.setattr(attachments, "local_now", lambda: real(2026, 5, 13, 10, 0))
    authed_client.post("/events/", json={"name": "Concert", "start_date": "2026-05-11", "start_time": "20:00",
                                         "end_date": "2026-05-11", "end_time": "23:00"})
    a = _upload(authed_client, 2026, 5, 11).json["attachment"]
    assert a["taken_at"] is None and a["event_id"] is not None
