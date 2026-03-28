"""add book rating review and dnf

Revision ID: e4f0d0f4e7a1
Revises: 3c1d7f8a9b21
Create Date: 2026-03-28 22:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f0d0f4e7a1"
down_revision: str | None = "3c1d7f8a9b21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(sa.Column("rating", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("review", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("review_updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("reading_state", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("reading_state")
        batch_op.drop_column("review_updated_at")
        batch_op.drop_column("review")
        batch_op.drop_column("rating")
