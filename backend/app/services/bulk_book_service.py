"""Bulk operations for books: metadata updates and shelf moves."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.book_service import (
    BookNotFound as BookNotFoundBS,
)
from app.services.book_service import (
    FileOperationError,
    ShelfNotFound,
    move_book,
)
from app.services.genre_service import (
    BookNotFound as BookNotFoundGS,
)
from app.services.genre_service import (
    GenreNotFound,
    assign_genre,
    remove_genre,
)
from app.services.tag_service import (
    BookNotFound as BookNotFoundTS,
)
from app.services.tag_service import (
    TagNotFound,
    assign_tag,
    remove_tag,
)


async def bulk_update_metadata(
    session: AsyncSession,
    book_ids: list[str],
    *,
    add_tag_ids: list[int] | None = None,
    remove_tag_ids: list[int] | None = None,
    add_genre_ids: list[int] | None = None,
    remove_genre_ids: list[int] | None = None,
) -> list[dict]:
    """Apply tag/genre add/remove to multiple books. Returns per-book results."""
    results: list[dict] = []
    for book_id in book_ids:
        try:
            for tag_id in add_tag_ids or []:
                await assign_tag(session, book_id, tag_id)
            for tag_id in remove_tag_ids or []:
                try:
                    await remove_tag(session, book_id, tag_id)
                except TagNotFound:
                    pass  # tag wasn't assigned — not an error
            for genre_id in add_genre_ids or []:
                await assign_genre(session, book_id, genre_id)
            for genre_id in remove_genre_ids or []:
                try:
                    await remove_genre(session, book_id, genre_id)
                except GenreNotFound:
                    pass  # genre wasn't assigned — not an error
            results.append({"book_id": book_id, "success": True, "error": None})
        except (BookNotFoundTS, BookNotFoundGS, TagNotFound, GenreNotFound) as exc:
            results.append({"book_id": book_id, "success": False, "error": str(exc)})
    return results


async def bulk_move_books(
    session: AsyncSession,
    book_ids: list[str],
    target_shelf_id: int,
) -> list[dict]:
    """Move multiple books to a target shelf. Returns per-book results."""
    results: list[dict] = []
    for book_id in book_ids:
        try:
            await move_book(session, book_id, target_shelf_id)
            results.append({"book_id": book_id, "success": True, "error": None})
        except (BookNotFoundBS, ShelfNotFound, FileOperationError) as exc:
            results.append({"book_id": book_id, "success": False, "error": str(exc)})
    return results
