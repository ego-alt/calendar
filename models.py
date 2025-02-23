from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import func

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String, unique=True, nullable=False)
    created_at = db.Column(db.DateTime, server_default=func.now())

    # Relationships
    daily_logs = db.relationship("DailyLog", back_populates="user")
    events = db.relationship("Event", back_populates="user")


class Mood(db.Model):
    __tablename__ = "moods"

    id = db.Column(db.Integer, primary_key=True)
    color = db.Column(db.String, nullable=False)  # Store as hex color
    name = db.Column(db.String, nullable=False)


class DailyLog(db.Model):
    __tablename__ = "daily_logs"

    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    mood_id = db.Column(db.Integer, db.ForeignKey("moods.id"), nullable=True)

    # Make date unique per user
    __table_args__ = (db.UniqueConstraint("user_id", "date", name="unique_user_date"),)

    # Relationships
    user = db.relationship("User", back_populates="daily_logs")
    mood = db.relationship("Mood", uselist=False)


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    name = db.Column(db.String, nullable=False)
    notes = db.Column(db.String)
    with_who = db.Column(db.String)
    where = db.Column(db.String)

    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, server_default=func.now())
    last_modified = db.Column(
        db.DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = db.relationship("User", back_populates="events")
