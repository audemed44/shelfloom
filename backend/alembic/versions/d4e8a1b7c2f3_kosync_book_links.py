"""link KOSync progress to books; store device_id and web locator

KOReader identifies a document by a digest of the file. Recording the matched
book lets a position survive the file being rewritten (a new digest). The
percentage KOReader sends is 0–1; rows stored as 0–100 are scaled down.

Revision ID: d4e8a1b7c2f3
Revises: c81d6e2f4a90
Create Date: 2026-09-28 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e8a1b7c2f3"
down_revision: str | None = "c81d6e2f4a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("kosync_progress") as batch_op:
        batch_op.add_column(sa.Column("device_id", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("book_id", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("locator", sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            "fk_kosync_progress_book_id", "books", ["book_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index("ix_kosync_progress_book_id", ["book_id"])

    op.execute("UPDATE kosync_progress SET percentage = percentage / 100.0 WHERE percentage > 1")
    op.execute(
        """
        UPDATE kosync_progress SET book_id = COALESCE(
            (SELECT b.id FROM books b WHERE b.file_hash_md5_ko = kosync_progress.document LIMIT 1),
            (SELECT h.book_id FROM book_hashes h
              WHERE h.hash_md5_ko = kosync_progress.document LIMIT 1)
        )
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("kosync_progress") as batch_op:
        batch_op.drop_index("ix_kosync_progress_book_id")
        batch_op.drop_constraint("fk_kosync_progress_book_id", type_="foreignkey")
        batch_op.drop_column("locator")
        batch_op.drop_column("book_id")
        batch_op.drop_column("device_id")
