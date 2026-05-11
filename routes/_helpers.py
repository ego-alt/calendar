from functools import wraps

from flask import current_app, jsonify
from flask_login import current_user


def current_user_id():
    return current_user.id if current_user.is_authenticated else None


def json_login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({"status": "error", "message": "Authentication required"}), 401
        try:
            return func(*args, **kwargs)
        except Exception:
            current_app.logger.exception("Unhandled error in %s", func.__name__)
            return jsonify({"status": "error", "message": "Internal server error"}), 500

    return wrapper
