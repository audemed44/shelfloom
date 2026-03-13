"""Book CRUD and search service."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.shelf import Shelf
from app.schemas.book import BookUpdate


class BookNotFound(Exception):
    pass


class ShelfNotFound(Exception):
    pass


class FileOperationError(Exception):
    pass


async def list_books(
    session: AsyncSession,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
    shelf_id: int | None = None,
    format: str | None = None,
    tag: str | None = None,
    series_id: int | None = None,
) -> tuple[list[Book], int]:
    """Return (books, total_count)."""
    query = select(Book)

    if search:
        pattern = f"%{search}%"
        query = query.where(
            Book.title.ilike(pattern) | Book.author.ilike(pattern)
        )
    if shelf_id is not None:
        query = query.where(Book.shelf_id == shelf_id)
    if format is not None:
        query = query.where(Book.format == format)
    if series_id is not None:
        from app.models.series import BookSeries
        query = query.join(BookSeries, Book.id == BookSeries.book_id).where(
            BookSeries.series_id == series_id
        )
    if tag is not None:
        from app.models.tag import BookTag, Tag
        query = query.join(BookTag, Book.id == BookTag.book_id).join(
            Tag, BookTag.tag_id == Tag.id
        ).where(Tag.name == tag)

    # Count
    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Paginate
    offset = (page - 1) * per_page
    query = query.order_by(Book.date_added.desc()).offset(offset).limit(per_page)
    result = await session.execute(query)
    return result.scalars().all(), total  # type: ignore[return-value]


async def get_book(session: AsyncSession, book_id: str) -> Book:
    result = await session.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if book is None:
        raise BookNotFound(f"Book {book_id} not found")
    return book


async def update_book(session: AsyncSession, book_id: str, data: BookUpdate) -> Book:
    book = await get_book(session, book_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(book, field, value)
    await session.commit()
    await session.refresh(book)
    return book


async def delete_book(
    session: AsyncSession, book_id: str, delete_file: bool = False
) -> None:
    book = await get_book(session, book_id)
    if delete_file:
        shelf_result = await session.execute(
            select(Shelf).where(Shelf.id == book.shelf_id)
        )
        shelf = shelf_result.scalar_one_or_none()
        if shelf:
            full_path = Path(shelf.path) / book.file_path
            if full_path.exists():
                full_path.unlink()
            # Remove .sdr folder if present
            sdr = full_path.parent / (full_path.name + ".sdr")
            if sdr.is_dir():
                shutil.rmtree(sdr)
    await session.delete(book)
    await session.commit()


async def move_book(
    session: AsyncSession,
    book_id: str,
    target_shelf_id: int,
) -> Book:
    """Move a book file to a different shelf (safe copy-verify-delete)."""
    book = await get_book(session, book_id)
    if book.shelf_id == target_shelf_id:
        return book

    src_shelf_result = await session.execute(
        select(Shelf).where(Shelf.id == book.shelf_id)
    )
    src_shelf = src_shelf_result.scalar_one_or_none()
    if src_shelf is None:
        raise ShelfNotFound(f"Source shelf {book.shelf_id} not found")

    dst_shelf_result = await session.execute(
        select(Shelf).where(Shelf.id == target_shelf_id)
    )
    dst_shelf = dst_shelf_result.scalar_one_or_none()
    if dst_shelf is None:
        raise ShelfNotFound(f"Target shelf {target_shelf_id} not found")

    src_path = Path(src_shelf.path) / book.file_path
    dst_path = Path(dst_shelf.path) / book.file_path

    dst_path.parent.mkdir(parents=True, exist_ok=True)

    # Copy-verify-delete
    shutil.copy2(str(src_path), str(dst_path))
    if dst_path.stat().st_size != src_path.stat().st_size:
        dst_path.unlink()
        raise FileOperationError("File copy verification failed (size mismatch)")

    # Move .sdr if present
    src_sdr = src_path.parent / (src_path.name + ".sdr")
    if src_sdr.is_dir():
        dst_sdr = dst_path.parent / (dst_path.name + ".sdr")
        shutil.copytree(str(src_sdr), str(dst_sdr))
        shutil.rmtree(str(src_sdr))

    src_path.unlink()

    book.shelf_id = target_shelf_id
    await session.commit()
    await session.refresh(book)
    return book
