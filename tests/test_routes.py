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
    response = client.post("/auth/login", data={"username": "alice", "password": "wrong"})
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

    updated = authed_client.put(f"/events/{event['id']}", json={
        **{k: v for k, v in event.items() if k not in {"id", "subevents", "start_time", "end_time"}},
        "name": "Coffee with Sam",
        "start_date": "11-05-2026",
        "start_time": "14:30",
        "end_date": "11-05-2026",
        "end_time": "15:30",
    })
    assert updated.status_code == 200
    assert authed_client.get("/events?year=2026&month=5&day=11").get_json()["events"][0]["name"] == "Coffee with Sam"

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
        "year": 2026, "month": 5, "day": 11, "color": "rgb(46, 204, 113)",
    })
    assert update.status_code == 200

    month = authed_client.get("/get_month?year=2026&month=5").get_json()
    assert month["mood_colors"]["11"] == "rgb(46, 204, 113)"

    toggle = authed_client.post("/mood/marker/toggle", json={
        "year": 2026, "month": 5, "day": 11,
    })
    assert toggle.status_code == 200
    assert toggle.get_json()["has_marker"] is True
    assert 11 in authed_client.get("/get_month?year=2026&month=5").get_json()["days_with_marker"]
