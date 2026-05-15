import os
import pathlib
import secrets

from flask import Flask
from flask_login import LoginManager
from flask_migrate import Migrate
from werkzeug.middleware.proxy_fix import ProxyFix

from models import db
from proxy_auth import load_user_from_proxy_header
from routes import (
    attachment_blueprint,
    auth_blueprint,
    event_blueprint,
    index_blueprint,
    mood_blueprint,
)


def create_app(config=None):
    app = Flask(__name__)
    app.url_map.strict_slashes = False
    db_path = pathlib.Path(app.instance_path) / "events.db"
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    app.config.setdefault(
        "ATTACHMENT_DIR", str(pathlib.Path(app.instance_path) / "attachments")
    )
    app.config["AUTH_PROXY_HEADER"] = os.environ.get("AUTH_PROXY_HEADER") or None
    _app_root = os.environ.get("APPLICATION_ROOT", "").strip()
    app.config["APPLICATION_ROOT"] = _app_root if _app_root else "/"
    if config:
        app.config.update(config)

    pathlib.Path(app.config["ATTACHMENT_DIR"]).mkdir(parents=True, exist_ok=True)

    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

    @app.get("/healthz")
    def healthz():
        return "", 200

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    @login_manager.user_loader
    def load_user(user_id):
        from models import User

        return db.session.get(User, int(user_id))

    @login_manager.request_loader
    def load_user_from_request(_request):
        return load_user_from_proxy_header()

    app.register_blueprint(attachment_blueprint)
    app.register_blueprint(auth_blueprint)
    app.register_blueprint(event_blueprint)
    app.register_blueprint(index_blueprint)
    app.register_blueprint(mood_blueprint)

    db.init_app(app)
    Migrate(app, db)
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=8001)
