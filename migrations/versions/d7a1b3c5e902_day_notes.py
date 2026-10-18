"""day notes: a free-text note on the day itself

A note belongs to the day (daily_logs), not to an entry: no name, no times.
It gets its own search index beside the entries' (FTS5 + embedding).

Revision ID: d7a1b3c5e902
Revises: c4e9f2a7b310
Create Date: 2026-10-19 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7a1b3c5e902'
down_revision = 'c4e9f2a7b310'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('daily_logs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('note', sa.Text(), nullable=True))
    op.create_table(
        'day_note_embedding',
        sa.Column('daily_log_id', sa.Integer(), sa.ForeignKey('daily_logs.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('embedding', sa.LargeBinary(), nullable=False),
        sa.Column('model', sa.String(), nullable=False),
        sa.Column('source_hash', sa.String(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS day_note_fts "
        "USING fts5(daily_log_id UNINDEXED, text, tokenize = 'porter unicode61')"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS day_note_fts")
    op.drop_table('day_note_embedding')
    with op.batch_alter_table('daily_logs', schema=None) as batch_op:
        batch_op.drop_column('note')
