"""add mood_key and backfill from moods table

Revision ID: 3a4b5c6d7e8f
Revises: da80a5e1ce02
Create Date: 2026-06-19

"""
import re

from alembic import op
import sqlalchemy as sa

revision = '3a4b5c6d7e8f'
down_revision = 'da80a5e1ce02'
branch_labels = None
depends_on = None

# Map existing moods rows to config keys by COLOUR, not name: every row's name
# is "Custom" in practice, so the colour (RGB triple) is the only stable
# identity. Triples are moods.py's palette (#RRGGBB -> (r, g, b)); ids differ
# between environments so we never key on them.
RGB_TO_KEY = {
    (46, 204, 113): "great",
    (22, 165, 133): "good",
    (0, 149, 149): "okay",
    (54, 116, 181): "low",
    (91, 91, 181): "rough",
}

_RGB = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")


def _rgb_triple(color):
    """Parse an ``rgba(...)`` or ``#RRGGBB[AA]`` colour into an (r, g, b) tuple."""
    if not color:
        return None
    m = _RGB.match(color)
    if m:
        return tuple(int(x) for x in m.groups())
    h = color.lstrip("#")
    if len(h) >= 6:
        try:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return None
    return None


def upgrade():
    with op.batch_alter_table("daily_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("mood_key", sa.String(), nullable=True))

    conn = op.get_bind()
    moods = conn.execute(sa.text("SELECT id, color FROM moods")).fetchall()
    for mood_id, color in moods:
        key = RGB_TO_KEY.get(_rgb_triple(color))
        if key:
            conn.execute(
                sa.text("UPDATE daily_logs SET mood_key = :key WHERE mood_id = :id"),
                {"key": key, "id": mood_id},
            )

    unmapped = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM daily_logs WHERE mood_id IS NOT NULL AND mood_key IS NULL"
        )
    ).scalar()
    if unmapped:
        raise RuntimeError(
            f"Mood migration aborted: {unmapped} daily_log row(s) have mood_id but no "
            f"mapped key. Check RGB_TO_KEY against your moods table colours and retry."
        )


def downgrade():
    with op.batch_alter_table("daily_logs", schema=None) as batch_op:
        batch_op.drop_column("mood_key")
