import hashlib

import numpy as np
import pytest
from werkzeug.security import generate_password_hash

import search_index
from models import User, db


@pytest.fixture(autouse=True)
def stub_embeddings(monkeypatch):
    """Deterministic embeddings so tests never load/download the ONNX model."""

    def fake_embed(texts):
        out = []
        for text in texts:
            digest = hashlib.sha256(text.encode()).digest()
            # Centered so distinct texts score ~0 cosine and identical texts ~1,
            # mirroring how a real model separates matches from non-matches.
            vec = np.frombuffer(digest, dtype=np.uint8).astype(np.float32) - 128.0
            norm = float(np.linalg.norm(vec))
            if norm:
                vec = vec / norm
            out.append(vec.astype(np.float32))
        return out

    monkeypatch.setattr(search_index, "embed_texts", fake_embed)
    monkeypatch.setattr(search_index, "embed_query", lambda text: fake_embed([text])[0])


def _make_event(client, name, day=11, **fields):
    resp = client.post("/events", json={
        "name": name,
        "start_date": f"{day:02d}-05-2026",
        "start_time": "14:00",
        "end_date": f"{day:02d}-05-2026",
        "end_time": "15:00",
        **fields,
    })
    assert resp.status_code == 200


def test_search_data_requires_auth(client):
    assert client.get("/search/data?q=coffee").status_code == 401


def test_search_page_renders_for_authed(authed_client):
    html = authed_client.get("/search").get_data(as_text=True)
    assert 'id="searchView"' in html
    assert 'INITIAL_VIEW = "search"' in html


def test_search_page_redirects_anon(client):
    resp = client.get("/search")
    assert resp.status_code == 302


def test_search_finds_and_ranks_by_text(authed_client):
    _make_event(authed_client, "Coffee with Sam", where="Blue Bottle", notes="monthly catch-up")
    _make_event(authed_client, "Dentist appointment", day=12)

    results = authed_client.get("/search/data?q=coffee").get_json()["results"]
    assert results[0]["name"] == "Coffee with Sam"  # best match first
    assert "Dentist appointment" not in [r["name"] for r in results]


def test_search_filter_by_who(authed_client):
    _make_event(authed_client, "Lunch", with_who="Alex")
    _make_event(authed_client, "Lunch", day=12, with_who="Sam")

    results = authed_client.get("/search/data?who=Alex").get_json()["results"]
    assert len(results) == 1
    assert results[0]["with_who"] == "Alex"


def test_search_filter_by_date_range(authed_client):
    _make_event(authed_client, "Early", day=5)
    _make_event(authed_client, "Late", day=25)

    results = authed_client.get("/search/data?from=2026-05-20&to=2026-05-31").get_json()["results"]
    assert [r["name"] for r in results] == ["Late"]


def test_search_scoped_to_user(authed_client, app):
    _make_event(authed_client, "Secret meeting", notes="confidential")

    with app.app_context():
        db.session.add(User(username="mallory", password_hash=generate_password_hash("pw")))
        db.session.commit()
    other = app.test_client()
    other.post("/auth/login", data={"username": "mallory", "password": "pw"})

    assert other.get("/search/data?q=secret").get_json()["results"] == []


def test_search_natural_language_date(authed_client):
    _make_event(authed_client, "Dinner", day=16)
    _make_event(authed_client, "Brunch", day=20)

    res = authed_client.get("/search/data?q=what happened on 16 May 2026").get_json()
    assert [r["name"] for r in res["results"]] == ["Dinner"]
    assert "16 May 2026" in res["parsed"]["labels"]


def test_search_nl_date_with_content(authed_client):
    _make_event(authed_client, "Dinner", day=16)
    _make_event(authed_client, "Standup", day=16)

    names = [r["name"] for r in authed_client.get(
        "/search/data?q=dinner on 16 May 2026").get_json()["results"]]
    assert names == ["Dinner"]  # date scopes the day, "dinner" picks the entry


def test_explicit_dates_override_nl_query(authed_client):
    _make_event(authed_client, "Dinner", day=16)
    _make_event(authed_client, "Brunch", day=20)

    res = authed_client.get(
        "/search/data?q=16 May 2026&from=2026-05-20&to=2026-05-20").get_json()
    assert [r["name"] for r in res["results"]] == ["Brunch"]
    assert res["parsed"]["labels"] == []  # router date not applied → no chip


def test_search_routes_who_from_text(authed_client):
    _make_event(authed_client, "Coffee", with_who="Mom")
    _make_event(authed_client, "Coffee", day=12, with_who="Sarah")

    res = authed_client.get("/search/data?q=coffee with Mom").get_json()
    assert [r["with_who"] for r in res["results"]] == ["Mom"]
    assert "with: Mom" in res["parsed"]["labels"]


def test_search_reflects_edits_and_deletes(authed_client):
    _make_event(authed_client, "Standup", notes="status update")
    event_id = authed_client.get("/events?year=2026&month=5&day=11").get_json()["events"][0]["id"]

    # not yet present
    assert authed_client.get("/search/data?q=retrospective").get_json()["results"] == []

    authed_client.put(f"/events/{event_id}", json={
        "name": "Standup",
        "start_date": "11-05-2026", "start_time": "14:00",
        "end_date": "11-05-2026", "end_time": "15:00",
        "notes": "sprint retrospective",
    })
    hit = authed_client.get("/search/data?q=retrospective").get_json()["results"]
    assert hit[0]["id"] == event_id

    authed_client.delete(f"/events/{event_id}")
    assert authed_client.get("/search/data?q=retrospective").get_json()["results"] == []
