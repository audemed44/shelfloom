"""link existing ebooks to serials as volumes

Adds serial_volumes.kind ("generated" | "ebook") and makes the chapter range
optional, since an author's published ebook may not map to known chapters.

Revision ID: c81d6e2f4a90
Revises: 9a7c3e51d2f4
Create Date: 2026-09-27 21:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c81d6e2f4a90"
down_revision: str | None = "9a7c3e51d2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("serial_volumes") as batch_op:
        batch_op.add_column(
            sa.Column("kind", sa.Text(), nullable=False, server_default="generated")
        )
        batch_op.alter_column("chapter_start", existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column("chapter_end", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM serial_volumes WHERE kind = 'ebook' AND chapter_start IS NULL")
    with op.batch_alter_table("serial_volumes") as batch_op:
        batch_op.alter_column("chapter_end", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("chapter_start", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("kind")
