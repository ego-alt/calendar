import pytest
from werkzeug.security import generate_password_hash

from app import create_app
from models import Mood, User, db


@pytest.fixture
def app(tmp_path):
    app = create_app({
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path/'test.db'}",
        "TESTING": True,
        "SECRET_KEY": "test-secret",
    })
    with app.app_context():
        db.create_all()
        db.session.add(Mood(color="rgb(46, 204, 113)", name="emerald"))
        db.session.commit()
        yield app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def user(app):
    with app.app_context():
        u = User(username="grey", password_hash=generate_password_hash("pw"))
        db.session.add(u)
        db.session.commit()
        return u.id


@pytest.fixture
def authed_client(client, user):
    response = client.post("/auth/login", data={"username": "grey", "password": "pw"})
    assert response.status_code == 200
    return client
