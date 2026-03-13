"""Tag CRUD and book-tag assignment."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.tag import BookTag, Tag


class TagNotFound(Exception):
    pass


class TagConflict(Exception):
    pass


class BookNotFound(Exception):
    pass


async def list_tags(session: AsyncSession) -> list[Tag]:
    result = await session.execute(select(Tag).order_by(Tag.name))
    return list(result.scalars().all())


async def get_tag(session: AsyncSession, tag_id: int) -> Tag:
    result = await session.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if tag is None:
        raise TagNotFound(f"Tag {tag_id} not found")
    return tag


async def create_tag(session: AsyncSession, name: str) -> Tag:
    tag = Tag(name=name.strip())
    session.add(tag)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise TagConflict(f"Tag '{name}' already exists")
    await session.refresh(tag)
    return tag


async def delete_tag(session: AsyncSession, tag_id: int) -> None:
    tag = await get_tag(session, tag_id)
    await session.delete(tag)
    await session.commit()


async def assign_tag(session: AsyncSession, book_id: str, tag_id: int) -> None:
    """Assign a tag to a book. No-op if already assigned."""
    book_result = await session.execute(select(Book).where(Book.id == book_id))
    if book_result.scalar_one_or_none() is None:
        raise BookNotFound(f"Book {book_id} not found")
    await get_tag(session, tag_id)  # raises TagNotFound if missing

    existing = await session.execute(
        select(BookTag).where(BookTag.book_id == book_id, BookTag.tag_id == tag_id)
    )
    if existing.scalar_one_or_none() is None:
        session.add(BookTag(book_id=book_id, tag_id=tag_id))
        await session.commit()


async def remove_tag(session: AsyncSession, book_id: str, tag_id: int) -> None:
    """Remove a tag from a book."""
    result = await session.execute(
        select(BookTag).where(BookTag.book_id == book_id, BookTag.tag_id == tag_id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise TagNotFound(f"Tag {tag_id} not assigned to book {book_id}")
    await session.delete(entry)
    await session.commit()
