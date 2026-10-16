"""Endpoints for programmatic clients (the MCP server): fetch one entry or
moment, list a date range, and get a new moment's id back."""


def _entry(client, **overrides):
    payload = {
        "name": "Dinner", "start_date": "2026-03-10", "start_time": "19:00",
        "end_date": "2026-03-10", "end_time": "21:00", "notes": "ramen", **overrides,
    }
    res = client.post("/events/", json=payload)
    assert res.status_code == 200, res.get_json()
    return res.get_json()["id"]


def test_get_one_entry_with_moments(authed_client):
    eid = _entry(authed_client)
    sub = authed_client.post(f"/events/{eid}/subevents", json={
        "name": "Dessert", "start_date": "2026-03-10", "start_time": "20:30",
        "end_date": "2026-03-10", "end_time": "20:45",
    }).get_json()
    assert isinstance(sub["id"], int)

    event = authed_client.get(f"/events/{eid}").get_json()["event"]
    assert event["name"] == "Dinner" and event["notes"] == "ramen"
    assert [s["id"] for s in event["subevents"]] == [sub["id"]]

    moment = authed_client.get(f"/events/subevents/{sub['id']}").get_json()["subevent"]
    assert moment["name"] == "Dessert" and moment["event_id"] == eid


def test_get_missing_or_deleted_entry_is_404(authed_client):
    eid = _entry(authed_client)
    authed_client.delete(f"/events/{eid}")
    assert authed_client.get(f"/events/{eid}").status_code == 404
    assert authed_client.get("/events/99999").status_code == 404
    assert authed_client.get("/events/subevents/99999").status_code == 404


def test_range_lists_overlapping_entries(authed_client):
    _entry(authed_client, name="Before", start_date="2026-02-27", end_date="2026-02-28")
    _entry(authed_client, name="Trip", start_date="2026-02-28", end_date="2026-03-02")
    _entry(authed_client, name="Inside", start_date="2026-03-05", end_date="2026-03-05")
    _entry(authed_client, name="After", start_date="2026-03-08", end_date="2026-03-08")

    res = authed_client.get("/events/range?from=2026-03-01&to=2026-03-07").get_json()
    assert [e["name"] for e in res["events"]] == ["Trip", "Inside"]

    # `to` is inclusive.
    res = authed_client.get("/events/range?from=2026-03-08&to=2026-03-08").get_json()
    assert [e["name"] for e in res["events"]] == ["After"]


def test_range_rejects_bad_input(authed_client):
    assert authed_client.get("/events/range?from=nope&to=2026-03-01").status_code == 400
    assert authed_client.get("/events/range?from=2026-03-05&to=2026-03-01").status_code == 400
    assert authed_client.get("/events/range?from=2024-01-01&to=2026-01-01").status_code == 400


def test_endpoints_are_per_user(app, authed_client):
    from werkzeug.security import generate_password_hash

    from models import User, db

    eid = _entry(authed_client)
    with app.app_context():
        db.session.add(User(username="other", password_hash=generate_password_hash("pw")))
        db.session.commit()
    other = app.test_client()
    other.post("/auth/login", data={"username": "other", "password": "pw"})
    assert other.get(f"/events/{eid}").status_code == 404
    assert other.get("/events/range?from=2026-03-01&to=2026-03-31").get_json()["events"] == []


def test_api_requires_auth(client):
    assert client.get("/events/1").status_code == 401
    assert client.get("/events/range?from=2026-03-01&to=2026-03-02").status_code == 401


def test_move_moments_shifts_them_with_the_entry(authed_client):
    eid = _entry(authed_client)
    authed_client.post(f"/events/{eid}/subevents", json={
        "name": "Dessert", "start_date": "2026-03-10", "start_time": "20:30",
        "end_date": "2026-03-10", "end_time": "20:45",
    })
    moved = {
        "name": "Dinner", "start_date": "2026-03-12", "start_time": "19:00",
        "end_date": "2026-03-12", "end_time": "21:00",
    }
    # Without the flag the moment would be stranded, so the move is refused.
    assert authed_client.put(f"/events/{eid}", json=moved).status_code == 400

    res = authed_client.put(f"/events/{eid}", json={**moved, "move_moments": True})
    assert res.status_code == 200
    event = authed_client.get(f"/events/{eid}").get_json()["event"]
    assert event["start_time"] == "2026-03-12 19:00"
    assert event["subevents"][0]["start_time"] == "2026-03-12 20:30"
    assert event["subevents"][0]["end_time"] == "2026-03-12 20:45"
