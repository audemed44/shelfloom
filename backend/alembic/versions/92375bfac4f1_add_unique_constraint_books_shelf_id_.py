"""add unique constraint books shelf_id file_path

Revision ID: 92375bfac4f1
Revises: 1b4a2e8ee126
Create Date: 2026-03-15 13:42:56.426602

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "92375bfac4f1"
down_revision: str | None = "1b4a2e8ee126"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Remove duplicate (shelf_id, file_path) rows, keeping the one with the most
    # reading data (sessions + highlights). Ties broken by oldest date_added.
    # Only removes rows that have no reading data attached (safe to delete);
    # if duplicates exist WITH reading data, the unique index creation will fail
    # and the operator must resolve them manually via the Data Management UI.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE FROM books
            WHERE id IN (
                SELECT id FROM (
                    SELECT b.id,
                           ROW_NUMBER() OVER (
                               PARTITION BY b.shelf_id, b.file_path
                               ORDER BY (
                                   SELECT COUNT(*) FROM reading_sessions rs WHERE rs.book_id = b.id
                               ) DESC,
                               (
                                   SELECT COUNT(*) FROM highlights h WHERE h.book_id = b.id
                               ) DESC,
                               b.date_added ASC
                           ) AS rn
                    FROM books b
                ) ranked
                WHERE rn > 1
                AND NOT EXISTS (SELECT 1 FROM reading_sessions WHERE book_id = ranked.id)
                AND NOT EXISTS (SELECT 1 FROM highlights WHERE book_id = ranked.id)
                AND NOT EXISTS (SELECT 1 FROM reading_progress WHERE book_id = ranked.id)
            )
            """
        )
    )
    op.create_index(
        "ix_books_shelf_id_file_path",
        "books",
        ["shelf_id", "file_path"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_books_shelf_id_file_path", table_name="books")
