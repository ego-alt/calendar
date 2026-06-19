from flask import Blueprint, redirect, render_template, url_for
from flask_login import current_user

from utils import get_stats_data

from ._helpers import current_user_id

stats_blueprint = Blueprint("stats", __name__)


@stats_blueprint.route("/stats")
def stats():
    # Mirror index(): unauthenticated users land on the calendar (login overlay).
    if not current_user.is_authenticated:
        return redirect(url_for("index_routes.index"))
    return render_template("stats.html", data=get_stats_data(current_user_id()))
