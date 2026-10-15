from functools import wraps

from flask import current_app, jsonify
from flask_login import current_user
from werkzeug.exceptions import HTTPException


def current_user_id():
    return current_user.id if current_user.is_authenticated else None


def json_login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({"status": "error", "message": "Please sign in again."}), 401
        try:
            return func(*args, **kwargs)
        except HTTPException:   # e.g. 413 upload too large: let its handler answer
            raise
        except Exception:
            current_app.logger.exception("Unhandled error in %s", func.__name__)
            return jsonify({
                "status": "error", "message": "Something went wrong on our side. Try again.",
            }), 500

    return wrapper
