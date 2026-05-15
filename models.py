from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import func
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String, unique=True, nullable=False)
    password_hash = db.Column(db.String)
    created_at = db.Column(db.DateTime, server_default=func.now())

    # Relationships
    daily_logs = db.relationship("DailyLog", back_populates="user")
    events = db.relationship("Event", back_populates="user")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)


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
    has_marker = db.Column(db.Boolean, nullable=False, default=False)

    # Make date unique per user
    __table_args__ = (db.UniqueConstraint("user_id", "date", name="unique_user_date"),)

    user = db.relationship("User", back_populates="daily_logs")
    mood = db.relationship("Mood", uselist=False)
    attachments = db.relationship(
        "Attachment",
        back_populates="daily_log",
        cascade="all, delete-orphan",
        order_by="Attachment.created_at",
    )


class Attachment(db.Model):
    __tablename__ = "attachments"

    id = db.Column(db.Integer, primary_key=True)
    daily_log_id = db.Column(db.Integer, db.ForeignKey("daily_logs.id"), nullable=False)
    original_filename = db.Column(db.String, nullable=False)
    stored_name = db.Column(db.String, nullable=False, unique=True)
    mime_type = db.Column(db.String, nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, server_default=func.now())

    __table_args__ = (db.Index("ix_attachments_daily_log", "daily_log_id"),)

    daily_log = db.relationship("DailyLog", back_populates="attachments")


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
    last_modified = db.Column(db.DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (db.Index("ix_events_user_start", "user_id", "start_time"),)

    user = db.relationship("User", back_populates="events")
    subevents = db.relationship(
        "SubEvent", back_populates="parent_event", cascade="all, delete-orphan"
    )


class SubEvent(db.Model):
    __tablename__ = "subevents"

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id"), nullable=False)
    name = db.Column(db.String, nullable=False)
    notes = db.Column(db.String)
    with_who = db.Column(db.String)
    where = db.Column(db.String)

    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, server_default=func.now())
    last_modified = db.Column(db.DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (db.Index("ix_subevents_event_start", "event_id", "start_time"),)

    parent_event = db.relationship("Event", back_populates="subevents")
