"""add koreader partial md5 columns to books and book_hashes

Revision ID: 4593594f5da9
Revises: 92375bfac4f1
Create Date: 2026-03-15 14:04:48.367136

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4593594f5da9"
down_revision: str | None = "92375bfac4f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("book_hashes", sa.Column("hash_md5_ko", sa.Text(), nullable=True))
    op.add_column("books", sa.Column("file_hash_md5_ko", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("books", "file_hash_md5_ko")
    op.drop_column("book_hashes", "hash_md5_ko")
