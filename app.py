from flask import Flask, render_template, jsonify, request, session
from datetime import datetime, timedelta
import logging
from models import db, User, Mood, DailyLog, Event
from sqlalchemy.exc import IntegrityError
from utils import parse_event_datetime, get_month_data

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///events.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = "your-secret-key-here"  # Required for sessions

logger = logging.getLogger(__name__)

db.init_app(app)


def initialize_user():
    logging.info("Initializing user...")
    with app.app_context():
        # Try to get existing default user first
        user = User.query.filter_by(username="default").first()
        if user:
            session["user_id"] = user.id  # Store user ID in session
            return user

        # Only create new user if one doesn't exist
        try:
            user = User(username="default")
            db.session.add(user)
            db.session.commit()
            session["user_id"] = user.id  # Store user ID in session
            return user
        except IntegrityError:
            # In case of race condition, try one more time to get existing user
            db.session.rollback()
            user = User.query.filter_by(username="default").first()
            if user:
                session["user_id"] = user.id
                return user
            raise  # Re-raise if we still can't get a user


def get_current_user():
    with app.app_context():
        return User.query.get(session.get("user_id"))


@app.route("/")
def index():
    user = initialize_user()
    today = datetime.now()
    calendar_data, mood_colors, days_with_events = get_month_data(
        today.year, today.month, user.id
    )

    return render_template(
        "index.html",
        calendar_data=calendar_data,
        date_label=today.strftime("%B %Y"),
        current_year=today.year,
        current_month=today.month,
        current_day=today.day,
        mood_colors=mood_colors,
        days_with_events=days_with_events,
    )


@app.route("/get_month", methods=["GET"])
def get_month():
    year = int(request.args.get("year"))
    month = int(request.args.get("month"))
    # Handle year transition
    if month == 13:
        month = 1
        year += 1

    user = initialize_user()
    calendar_data, mood_colors, days_with_events = get_month_data(year, month, user.id)

    return jsonify(
        {
            "calendar_data": calendar_data,
            "month_label": datetime(year, month, 1).strftime("%B %Y"),
            "mood_colors": mood_colors,
            "days_with_events": days_with_events,
        }
    )


@app.route("/update_mood", methods=["POST"])
def update_mood():
    data = request.json
    logger.info(f"Received mood update request with data: {data}")

    try:
        user = get_current_user()
        if not user:
            logger.debug("Creating default user")
            user = User(username="default")
            db.session.add(user)
            db.session.flush()

        date = datetime(int(data["year"]), int(data["month"]), int(data["day"])).date()
        logger.debug(f"Looking up daily log for date: {date}")
        daily_log = DailyLog.query.filter_by(user_id=user.id, date=date).first()

        if data["color"] is None:
            # If color is null, delete the daily log if it exists
            if daily_log:
                db.session.delete(daily_log)
        else:
            # Handle normal mood setting
            mood = Mood.query.filter_by(color=data["color"]).first()
            if not mood:
                logger.debug(f"Creating new mood with color: {data['color']}")
                mood = Mood(color=data["color"], name="Custom")
                db.session.add(mood)
                db.session.flush()

            if daily_log:
                logger.info(f"Updating existing daily log for date: {date}")
                daily_log.mood_id = mood.id
            else:
                logger.info(f"Creating new daily log for date: {date}")
                daily_log = DailyLog(user_id=user.id, date=date, mood_id=mood.id)
                db.session.add(daily_log)

        db.session.commit()
        logger.info("Successfully updated mood")
        return jsonify({"status": "success"})

    except Exception as e:
        logger.error(f"Error updating mood: {str(e)}", exc_info=True)
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/events", methods=["GET", "POST"])
def events():
    try:
        user = get_current_user()

        if request.method == "GET":
            year = int(request.args.get("year"))
            month = int(request.args.get("month"))
            day = int(request.args.get("day"))

            # Get start and end of the requested day
            start_date = datetime(year, month, day)
            end_date = start_date + timedelta(days=1)

            # Query events for the current user and day
            events = (
                Event.query.filter(
                    Event.user_id == user.id,
                    Event.start_time < end_date,
                    Event.end_time >= start_date,
                )
                .order_by(Event.start_time)
                .all()
            )

            # Format events for JSON response
            events_data = [
                {
                    "id": event.id,
                    "name": event.name,
                    "start_time": event.start_time.strftime("%Y-%m-%d %H:%M"),
                    "end_time": event.end_time.strftime("%Y-%m-%d %H:%M")
                    if event.end_time
                    else None,
                    "notes": event.notes,
                    "with_who": event.with_who,
                    "where": event.where,
                }
                for event in events
            ]

            return jsonify({"status": "success", "events": events_data})

        else:  # POST method
            data = request.json
            start_datetime = parse_event_datetime(
                data["start_date"], data.get("start_time")
            )
            end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

            event = Event(
                user_id=user.id,
                name=data["name"],
                start_time=start_datetime,
                end_time=end_datetime,
                notes=data.get("notes"),
                with_who=data.get("with_who"),
                where=data.get("where"),
            )

            db.session.add(event)
            db.session.commit()

            return jsonify(
                {"status": "success", "message": "Event created successfully"}
            )

    except Exception as e:
        logger.error(f"Error handling events: {str(e)}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/events/<int:event_id>", methods=["PUT", "DELETE"])
def manage_event(event_id):
    try:
        user = get_current_user()
        event = Event.query.filter_by(id=event_id, user_id=user.id).first()

        if not event:
            return jsonify({"status": "error", "message": "Event not found"}), 404

        if request.method == "DELETE":
            db.session.delete(event)
            db.session.commit()
            return jsonify({"status": "success", "message": "Event deleted"})

        # PUT method
        data = request.json
        start_datetime = parse_event_datetime(
            data["start_date"], data.get("start_time")
        )
        end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

        event.name = data["name"]
        event.start_time = start_datetime
        event.end_time = end_datetime
        event.notes = data.get("notes")
        event.with_who = data.get("with_who")
        event.where = data.get("where")

        db.session.commit()
        return jsonify({"status": "success", "message": "Event updated"})

    except Exception as e:
        logger.error(f"Error managing event: {str(e)}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001, debug=True)
