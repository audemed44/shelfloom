"""Import KOReader statistics.sqlite3 sessions into Shelfloom DB."""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.koreader.stats_db_reader import StatsBook, StatsSession, read_stats_db
from app.models.book import Book, BookHash
from app.models.reading import ReadingSession

log = logging.getLogger(__name__)


async def _find_book_for_stats(
    session: AsyncSession,
    stats_book: StatsBook,
) -> Book | None:
    """
    Match a KOReader stats DB book to a Shelfloom Book.
    Strategy:
    1. Match by full MD5 (books.file_hash_md5)
    2. Match by historical MD5 (book_hashes.hash_md5)
    3. Match by title + author
    """
    if stats_book.md5:
        # Match current hash
        result = await session.execute(
            select(Book).where(Book.file_hash_md5 == stats_book.md5)
        )
        book = result.scalar_one_or_none()
        if book:
            return book

        # Match historical hashes
        result = await session.execute(
            select(Book).join(BookHash, Book.id == BookHash.book_id).where(
                BookHash.hash_md5 == stats_book.md5
            )
        )
        book = result.scalar_one_or_none()
        if book:
            return book

    # Match by title + author
    if stats_book.title and stats_book.authors:
        result = await session.execute(
            select(Book).where(
                Book.title == stats_book.title,
                Book.author == stats_book.authors,
            )
        )
        book = result.scalar_one_or_none()
        if book:
            return book

    return None


async def import_stats_db(
    session: AsyncSession,
    db_path: str | Path,
) -> dict[str, object]:
    """
    Import sessions from a KOReader statistics.sqlite3 into Shelfloom DB.
    Returns: {"imported": N, "skipped": N, "unmatched": [title, ...]}
    """
    books, sessions_by_book = read_stats_db(db_path)

    imported = 0
    skipped = 0
    unmatched: list[str] = []

    for stats_book in books:
        shelfloom_book = await _find_book_for_stats(session, stats_book)

        if shelfloom_book is None:
            log.debug("No match for stats DB book: %s", stats_book.title)
            unmatched.append(stats_book.title)
            continue

        book_sessions = sessions_by_book.get(stats_book.id, [])
        for sess in book_sessions:
            # Check if already imported (including dismissed)
            existing = await session.execute(
                select(ReadingSession).where(
                    ReadingSession.source_key == sess.source_key
                )
            )
            if existing.scalar_one_or_none() is not None:
                skipped += 1
                continue

            pages_read = sess.pages_read
            if shelfloom_book.page_count and stats_book.ko_total_pages:
                pages_read = round(
                    sess.pages_read * shelfloom_book.page_count / stats_book.ko_total_pages
                )

            reading_session = ReadingSession(
                book_id=shelfloom_book.id,
                start_time=sess.start_time,
                duration=sess.duration,
                pages_read=pages_read,
                source="stats_db",
                source_key=sess.source_key,
                dismissed=False,
            )
            session.add(reading_session)
            imported += 1

    await session.commit()
    return {"imported": imported, "skipped": skipped, "unmatched": unmatched}
