"""preserve stubbed serial chapters

Revision ID: 3c1d7f8a9b21
Revises: 6305b1bb905b
Create Date: 2026-03-28 17:35:00.000000

"""

from collections.abc import Sequence
from urllib.parse import urlparse

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c1d7f8a9b21"
down_revision: str | None = "6305b1bb905b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _normalize_source_key(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(fragment="").geturl()


def upgrade() -> None:
    with op.batch_alter_table("web_serials") as batch_op:
        batch_op.add_column(
            sa.Column(
                "live_chapter_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )

    with op.batch_alter_table("serial_chapters") as batch_op:
        batch_op.add_column(sa.Column("source_key", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "is_stubbed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(sa.Column("stubbed_at", sa.DateTime(), nullable=True))

    bind = op.get_bind()
    chapters = bind.execute(sa.text("SELECT id, source_url FROM serial_chapters")).fetchall()
    for chapter_id, source_url in chapters:
        bind.execute(
            sa.text("UPDATE serial_chapters SET source_key = :source_key WHERE id = :chapter_id"),
            {
                "chapter_id": chapter_id,
                "source_key": _normalize_source_key(source_url),
            },
        )
    op.execute(
        """
        UPDATE web_serials
        SET total_chapters = COALESCE(
                (SELECT MAX(ch.chapter_number)
                 FROM serial_chapters AS ch
                 WHERE ch.serial_id = web_serials.id),
                0
            ),
            live_chapter_count = COALESCE(
                (SELECT MAX(ch.chapter_number)
                 FROM serial_chapters AS ch
                 WHERE ch.serial_id = web_serials.id),
                0
            )
        """
    )

    with op.batch_alter_table("serial_chapters") as batch_op:
        batch_op.alter_column("source_key", existing_type=sa.Text(), nullable=False)
        batch_op.create_index(
            "ix_serial_chapters_serial_id_source_key",
            ["serial_id", "source_key"],
            unique=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("serial_chapters") as batch_op:
        batch_op.drop_index("ix_serial_chapters_serial_id_source_key")
        batch_op.drop_column("stubbed_at")
        batch_op.drop_column("is_stubbed")
        batch_op.drop_column("source_key")

    with op.batch_alter_table("web_serials") as batch_op:
        batch_op.drop_column("live_chapter_count")
