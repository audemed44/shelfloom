"""add reading goals (books to finish per year)

Revision ID: e7b2c9d41a05
Revises: d4e8a1b7c2f3
Create Date: 2026-09-28 08:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7b2c9d41a05"
down_revision: str | None = "d4e8a1b7c2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reading_goals",
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("books", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reading_goals")
