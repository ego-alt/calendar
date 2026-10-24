"""attachments: the time on a receipt, as the scanner read it, to link it to its entry

Revision ID: e5f6a7b8c9d0
Revises: d7a1b3c5e902
Create Date: 2026-10-24

"""
from alembic import op
import sqlalchemy as sa


revision = 'e5f6a7b8c9d0'
down_revision = 'd7a1b3c5e902'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('receipt_time', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.drop_column('receipt_time')
