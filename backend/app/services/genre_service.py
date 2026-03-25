"""Genre CRUD and book-genre assignment."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.genre import BookGenre, Genre


class GenreNotFound(Exception):
    pass


class GenreConflict(Exception):
    pass


class BookNotFound(Exception):
    pass


def normalize_genre_name(name: str) -> str:
    return name.strip()


async def list_genres(session: AsyncSession) -> list[Genre]:
    result = await session.execute(select(Genre).order_by(Genre.name))
    return list(result.scalars().all())


async def get_genre(session: AsyncSession, genre_id: int) -> Genre:
    result = await session.execute(select(Genre).where(Genre.id == genre_id))
    genre = result.scalar_one_or_none()
    if genre is None:
        raise GenreNotFound(f"Genre {genre_id} not found")
    return genre


async def get_genre_by_name(session: AsyncSession, name: str) -> Genre | None:
    normalized = normalize_genre_name(name)
    if not normalized:
        return None
    result = await session.execute(
        select(Genre).where(func.lower(Genre.name) == normalized.lower())
    )
    return result.scalar_one_or_none()


async def get_or_create_genre(session: AsyncSession, name: str) -> Genre:
    normalized = normalize_genre_name(name)
    existing = await get_genre_by_name(session, normalized)
    if existing is not None:
        return existing

    genre = Genre(name=normalized)
    session.add(genre)
    await session.flush()
    return genre


async def create_genre(session: AsyncSession, name: str) -> Genre:
    normalized = normalize_genre_name(name)
    existing = await get_genre_by_name(session, normalized)
    if existing is not None:
        raise GenreConflict(f"Genre '{name}' already exists")

    genre = Genre(name=normalized)
    session.add(genre)
    await session.commit()
    await session.refresh(genre)
    return genre


async def delete_genre(session: AsyncSession, genre_id: int) -> None:
    genre = await get_genre(session, genre_id)
    await session.delete(genre)
    await session.commit()


async def assign_genre(session: AsyncSession, book_id: str, genre_id: int) -> None:
    """Assign a genre to a book. No-op if already assigned."""
    book_result = await session.execute(select(Book).where(Book.id == book_id))
    if book_result.scalar_one_or_none() is None:
        raise BookNotFound(f"Book {book_id} not found")
    await get_genre(session, genre_id)

    existing = await session.execute(
        select(BookGenre).where(BookGenre.book_id == book_id, BookGenre.genre_id == genre_id)
    )
    if existing.scalar_one_or_none() is None:
        session.add(BookGenre(book_id=book_id, genre_id=genre_id))
        await session.commit()


async def remove_genre(session: AsyncSession, book_id: str, genre_id: int) -> None:
    """Remove a genre from a book."""
    result = await session.execute(
        select(BookGenre).where(BookGenre.book_id == book_id, BookGenre.genre_id == genre_id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise GenreNotFound(f"Genre {genre_id} not assigned to book {book_id}")
    await session.delete(entry)
    await session.commit()
