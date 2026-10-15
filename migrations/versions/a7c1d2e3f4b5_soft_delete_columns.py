"""soft delete: deleted_at on events, subevents and attachments

Deleting an entry, a moment or an attachment now only stamps deleted_at, so
it can be undone; rows older than 30 days are purged (see trash.py).

Revision ID: a7c1d2e3f4b5
Revises: f1a2b3c4d5e6
Create Date: 2026-10-15

"""
from alembic import op
import sqlalchemy as sa


revision = 'a7c1d2e3f4b5'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None

TABLES = ('events', 'subevents', 'attachments')


def upgrade():
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
            batch_op.create_index(f'ix_{table}_deleted_at', ['deleted_at'], unique=False)


def downgrade():
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_index(f'ix_{table}_deleted_at')
            batch_op.drop_column('deleted_at')
