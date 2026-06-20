"""drop mood_id column and moods table

Revision ID: 9f0a1b2c3d4e
Revises: 3a4b5c6d7e8f
Create Date: 2026-06-19

"""
from alembic import op
import sqlalchemy as sa

revision = '9f0a1b2c3d4e'
down_revision = '3a4b5c6d7e8f'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("daily_logs", schema=None) as batch_op:
        batch_op.drop_column("mood_id")

    op.drop_table("moods")


def downgrade():
    op.create_table(
        "moods",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("daily_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("mood_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_daily_logs_mood_id", "moods", ["mood_id"], ["id"])
