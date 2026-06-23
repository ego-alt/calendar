"""rebuild event_fts with porter stemming

Re-tokenizes the lexical index so query terms and indexed text match on their
common stem (runs/running -> run). FTS5's stored `text` column holds the original
document, so we copy it into a freshly-tokenized table — no reindex required.

Revision ID: f1a2b3c4d5e6
Revises: 8d34948237ad
Create Date: 2026-06-23 12:30:00.000000

"""
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = '8d34948237ad'
branch_labels = None
depends_on = None


def _rebuild(tokenize):
    op.execute(
        f"CREATE VIRTUAL TABLE event_fts_new USING fts5(event_id UNINDEXED, text{tokenize})"
    )
    op.execute("INSERT INTO event_fts_new(event_id, text) SELECT event_id, text FROM event_fts")
    op.execute("DROP TABLE event_fts")
    op.execute("ALTER TABLE event_fts_new RENAME TO event_fts")


def upgrade():
    _rebuild(", tokenize = 'porter unicode61'")


def downgrade():
    _rebuild("")
