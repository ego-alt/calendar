import os
import pathlib
import secrets

import click
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
    export_blueprint,
    index_blueprint,
    mood_blueprint,
    pwa_blueprint,
    search_blueprint,
    stats_blueprint,
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

    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)

    # Version static URLs by file date, so a deploy's new CSS/JS is fetched
    # at once instead of an older copy from the browser or offline cache.
    @app.url_defaults
    def _static_version(endpoint, values):
        if endpoint == "static" and "filename" in values and "v" not in values:
            path = pathlib.Path(app.static_folder) / values["filename"]
            try:
                values["v"] = int(path.stat().st_mtime)
            except OSError:
                pass

    @app.errorhandler(413)
    def too_large(_e):
        mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return {"status": "error", "message": f"That file is over {mb} MB."}, 413

    @app.get("/healthz")
    def healthz():
        return "", 200

    @app.context_processor
    def inject_template_globals():
        # `proxy_mode` lets the shell render a mode-aware logout (dashboard
        # session vs local) — see templates/index.html. `moods` populates the
        # search drawer's mood filter from the single source in moods.py.
        from moods import MOODS
        from proxy_auth import is_proxy_mode

        return {"proxy_mode": is_proxy_mode(), "moods": MOODS}

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
    app.register_blueprint(export_blueprint)
    app.register_blueprint(index_blueprint)
    app.register_blueprint(mood_blueprint)
    app.register_blueprint(pwa_blueprint)
    app.register_blueprint(search_blueprint)
    app.register_blueprint(stats_blueprint)

    @app.cli.command("reindex")
    def reindex_command():
        """Rebuild the search index (embeddings + FTS) for all events."""
        from search_index import reindex_all

        count = reindex_all()
        print(f"Reindexed {count} events.")

    @app.cli.command("convert-daily-logs")
    @click.option("--apply", "do_apply", is_flag=True, help="Make the changes (default: preview only).")
    def convert_daily_logs_command(do_apply):
        """Turn whole-day "Daily log" entries into day notes (see day_notes.py)."""
        from day_notes import apply, plan

        steps, skipped = plan()
        for step in steps:
            e = step["event"]
            note = step["note"].replace("\n", " ")
            print(f"{step['day']}  note: {note[:70]}{'…' if len(note) > 70 else ''}")
            for s in step["moments"]:
                print(f"            + entry: {s.name} ({s.start_time:%d %b %H:%M}–{(s.end_time or s.start_time):%H:%M})")
            if step["photos"]:
                print(f"            {len(step['photos'])} photo(s) go back to the day")
        for e, why in skipped:
            print(f"skipped {e.start_time:%Y-%m-%d} “{e.name}”: {why}")
        moments = sum(len(s["moments"]) for s in steps)
        print(f"\n{len(steps)} Daily log(s) → day notes, {moments} moment(s) → entries, {len(skipped)} skipped.")
        if do_apply:
            apply(steps)
            print("Done. The old Daily log entries are in the trash for 30 days.")
        else:
            print("Preview only. Run again with --apply to make these changes.")

    @app.cli.command("purge-deleted")
    def purge_deleted_command():
        """Permanently remove entries and attachments deleted over 30 days ago."""
        from trash import purge_deleted

        print(f"Purged {purge_deleted()} deleted items.")

    db.init_app(app)
    Migrate(app, db)

    # Load the search model in the background at start-up, so the first search
    # doesn't wait several seconds for it (tests and CLI commands skip this).
    in_cli = click.get_current_context(silent=True) is not None   # flask db upgrade, flask run…
    if not app.config.get("TESTING") and not in_cli and os.environ.get("SEARCH_WARMUP", "1") == "1":
        import threading

        def _warm():
            try:
                from search_index import _get_model
                _get_model()
            except Exception:  # noqa: BLE001 — search still loads it on first use
                app.logger.warning("Search model warm-up failed", exc_info=True)

        threading.Thread(target=_warm, daemon=True).start()
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=8001)
