"""add created_at to reading_sessions

Revision ID: 9bc272692737
Revises: 4593594f5da9
Create Date: 2026-03-15 20:03:26.222101

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9bc272692737"
down_revision: str | None = "4593594f5da9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQLite does not allow ALTER TABLE ADD COLUMN with a non-constant default
    # (including CURRENT_TIMESTAMP), so we use batch mode which recreates the
    # table with the correct schema and then backfills existing rows.
    with op.batch_alter_table("reading_sessions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "created_at",
                sa.DateTime(),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=True,
            )
        )
    # Backfill pre-migration rows (they receive NULL from the INSERT SELECT)
    op.execute(
        sa.text(
            "UPDATE reading_sessions SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("reading_sessions") as batch_op:
        batch_op.drop_column("created_at")
