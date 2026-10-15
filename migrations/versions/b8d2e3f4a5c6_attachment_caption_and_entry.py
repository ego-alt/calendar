"""attachments: optional caption and link to an entry

Revision ID: b8d2e3f4a5c6
Revises: a7c1d2e3f4b5
Create Date: 2026-10-15

"""
from alembic import op
import sqlalchemy as sa


revision = 'b8d2e3f4a5c6'
down_revision = 'a7c1d2e3f4b5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('caption', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('event_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_attachments_event_id', 'events', ['event_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_index('ix_attachments_event_id', ['event_id'], unique=False)


def downgrade():
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.drop_index('ix_attachments_event_id')
        batch_op.drop_constraint('fk_attachments_event_id', type_='foreignkey')
        batch_op.drop_column('event_id')
        batch_op.drop_column('caption')
