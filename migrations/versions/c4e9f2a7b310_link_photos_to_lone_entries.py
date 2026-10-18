"""link existing photos to the day's only entry

Photos taken before attachments could belong to an entry all sit on their
day. Where that day has exactly one entry, they belong to it. Days with
several entries are left alone for you to choose in the photo viewer.

Revision ID: c4e9f2a7b310
Revises: b8d2e3f4a5c6
Create Date: 2026-10-19 10:00:00.000000

"""
from datetime import date, timedelta

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4e9f2a7b310'
down_revision = 'b8d2e3f4a5c6'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    photos = conn.execute(sa.text(
        "SELECT a.id, l.user_id, l.date FROM attachments a JOIN daily_logs l ON l.id = a.daily_log_id "
        "WHERE a.event_id IS NULL AND a.deleted_at IS NULL")).fetchall()
    for attachment_id, user_id, day in photos:
        d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
        entries = conn.execute(sa.text(
            "SELECT id FROM events WHERE user_id = :u AND deleted_at IS NULL "
            "AND start_time < :next AND COALESCE(end_time, start_time) >= :day LIMIT 2"),
            {"u": user_id, "day": f"{d.isoformat()} 00:00:00", "next": f"{(d + timedelta(days=1)).isoformat()} 00:00:00"}).fetchall()
        if len(entries) == 1:
            conn.execute(sa.text("UPDATE attachments SET event_id = :e WHERE id = :a"),
                         {"e": entries[0][0], "a": attachment_id})


def downgrade():
    # Links can't be told apart from ones made by hand afterwards; leave them.
    pass
