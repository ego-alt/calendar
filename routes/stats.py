from flask import Blueprint, jsonify, redirect, render_template, url_for
from flask_login import current_user

from utils import get_stats_data

from ._helpers import current_user_id

stats_blueprint = Blueprint("stats", __name__)


@stats_blueprint.route("/stats")
def stats():
    # Deep-link / refresh entry: render the calendar shell with the Stats view
    # pre-selected (the shell swaps views client-side from there — no reload).
    if not current_user.is_authenticated:
        return redirect(url_for("index_routes.index"))
    from .index import build_index_context

    return render_template("index.html", **build_index_context(), active_view="stats")


@stats_blueprint.route("/stats/data")
def stats_data():
    # JSON the Stats view fetches on open, so switching to it never reloads.
    if not current_user.is_authenticated:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(get_stats_data(current_user_id()))
