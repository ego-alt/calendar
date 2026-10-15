import pathlib
from io import BytesIO

from werkzeug.security import generate_password_hash

from models import Attachment, User, db


def test_index_anonymous(client):
    assert client.get("/").status_code == 200


def test_get_month_anonymous(client):
    response = client.get("/get_month?year=2026&month=5")
    assert response.status_code == 200
    body = response.get_json()
    assert body["month_label"] == "May 2026"


def test_get_year_anonymous(client):
    response = client.get("/get_year?year=2026")
    assert response.status_code == 200
    assert len(response.get_json()["months"]) == 12


def test_events_requires_auth(client):
    response = client.get("/events?year=2026&month=5&day=11")
    assert response.status_code == 401


def test_login_rejects_bad_password(client, user):
    response = client.post("/auth/login", data={"username": "grey", "password": "wrong"})
    assert response.status_code == 401


def test_event_crud(authed_client):
    create = authed_client.post("/events", json={
        "name": "Coffee",
        "start_date": "11-05-2026",
        "start_time": "14:00",
        "end_date": "11-05-2026",
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
        "start_date": "11-05-2026",
        "start_time": "14:30",
        "end_date": "11-05-2026",
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
        "start_date": "11-05-2026",
        "start_time": "09:00",
        "end_date": "11-05-2026",
        "end_time": "17:00",
    })
    assert parent.status_code == 200
    parent_id = authed_client.get("/events?year=2026&month=5&day=11").get_json()["events"][0]["id"]

    sub = authed_client.post(f"/events/{parent_id}/subevents", json={
        "name": "Opening keynote",
        "start_date": "11-05-2026",
        "start_time": "09:30",
        "end_date": "11-05-2026",
        "end_time": "10:30",
    })
    assert sub.status_code == 200

    listing = authed_client.get("/events?year=2026&month=5&day=11").get_json()
    sub_id = listing["events"][0]["subevents"][0]["id"]

    out_of_range = authed_client.post(f"/events/{parent_id}/subevents", json={
        "name": "After party",
        "start_date": "12-05-2026",
        "start_time": "20:00",
        "end_date": "12-05-2026",
        "end_time": "23:00",
    })
    assert out_of_range.status_code == 400

    deleted = authed_client.delete(f"/events/subevents/{sub_id}")
    assert deleted.status_code == 200


def test_mood_update_and_marker(authed_client):
    update = authed_client.post("/mood/update", json={
        "year": 2026, "month": 5, "day": 11, "mood": "great",
    })
    assert update.status_code == 200

    month = authed_client.get("/get_month?year=2026&month=5").get_json()
    assert month["mood_colors"]["11"] == "#2ecc7180"

    toggle = authed_client.post("/mood/marker/toggle", json={
        "year": 2026, "month": 5, "day": 11,
    })
    assert toggle.status_code == 200
    assert toggle.get_json()["has_marker"] is True
    assert 11 in authed_client.get("/get_month?year=2026&month=5").get_json()["days_with_marker"]


def _upload(
    client, year, month, day,
    *, filename="receipt.png", mime="image/png", content=b"PNGDATA",
):
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
    assert payload["size_bytes"] == len(b"PNGDATA")

    listed = authed_client.get("/attachments?year=2026&month=5&day=11").get_json()
    assert len(listed["attachments"]) == 1
    assert listed["attachments"][0]["filename"] == "receipt.png"


def test_attachment_download_serves_bytes(authed_client):
    upload = _upload(authed_client, 2026, 5, 11, content=b"hello-receipt")
    attachment_id = upload.get_json()["attachment"]["id"]

    response = authed_client.get(f"/attachments/{attachment_id}")
    assert response.status_code == 200
    assert response.data == b"hello-receipt"
    assert response.headers["Content-Type"].startswith("image/png")


def test_attachment_delete_removes_row_and_file(authed_client, app):
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
    # ISO (native date inputs) and the older DD-MM-YYYY both work
    assert authed_client.post("/events/", json=base).status_code == 200
    legacy = {**base, "start_date": "10-10-2026", "end_date": "10-10-2026"}
    assert authed_client.post("/events/", json=legacy).status_code == 200


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
