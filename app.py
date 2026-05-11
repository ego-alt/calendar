import os
import secrets

from flask import Flask
from flask_login import LoginManager
from flask_migrate import Migrate

from models import User, db
from routes import auth_blueprint, event_blueprint, index_blueprint, mood_blueprint


def create_app(config=None):
    app = Flask(__name__)
    app.url_map.strict_slashes = False
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///events.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    if config:
        app.config.update(config)

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

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
