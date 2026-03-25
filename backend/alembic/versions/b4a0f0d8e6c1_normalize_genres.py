"""normalize genres

Revision ID: b4a0f0d8e6c1
Revises: a5158d4bceab
Create Date: 2026-03-26 21:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4a0f0d8e6c1"
down_revision: str | None = "a5158d4bceab"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _split_genres(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def upgrade() -> None:
    op.create_table(
        "genres",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "book_genres",
        sa.Column("book_id", sa.Text(), nullable=False),
        sa.Column("genre_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["genre_id"], ["genres.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("book_id", "genre_id"),
    )

    conn = op.get_bind()
    rows = list(
        conn.execute(sa.text("SELECT id, genre FROM books WHERE genre IS NOT NULL")).mappings()
    )

    canonical_names: dict[str, str] = {}
    for row in rows:
        for name in _split_genres(row["genre"]):
            canonical_names.setdefault(name.lower(), name)

    genre_ids: dict[str, int] = {}
    for lower_name, canonical_name in sorted(
        canonical_names.items(), key=lambda item: item[1].lower()
    ):
        conn.execute(
            sa.text("INSERT INTO genres (name) VALUES (:name)"),
            {"name": canonical_name},
        )
        genre_id = conn.execute(
            sa.text("SELECT id FROM genres WHERE lower(name) = :name"),
            {"name": lower_name},
        ).scalar_one()
        genre_ids[lower_name] = int(genre_id)

    seen_pairs: set[tuple[str, int]] = set()
    for row in rows:
        book_id = row["id"]
        for name in _split_genres(row["genre"]):
            pair = (book_id, genre_ids[name.lower()])
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            conn.execute(
                sa.text("INSERT INTO book_genres (book_id, genre_id) VALUES (:book_id, :genre_id)"),
                {"book_id": book_id, "genre_id": pair[1]},
            )

    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("genre")


def downgrade() -> None:
    conn = op.get_bind()

    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(sa.Column("genre", sa.Text(), nullable=True))

    rows = list(
        conn.execute(
            sa.text(
                """
                SELECT bg.book_id, g.name
                FROM book_genres bg
                JOIN genres g ON g.id = bg.genre_id
                ORDER BY bg.book_id, lower(g.name), g.name
                """
            )
        ).mappings()
    )

    by_book: dict[str, list[str]] = {}
    for row in rows:
        by_book.setdefault(row["book_id"], []).append(row["name"])

    for book_id, names in by_book.items():
        conn.execute(
            sa.text("UPDATE books SET genre = :genre WHERE id = :book_id"),
            {"book_id": book_id, "genre": ", ".join(names)},
        )

    op.drop_table("book_genres")
    op.drop_table("genres")
