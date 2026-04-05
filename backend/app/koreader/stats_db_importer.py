"""Import KOReader statistics.sqlite3 sessions into Shelfloom DB."""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.koreader.stats_db_reader import StatsBook, read_stats_db
from app.models.book import Book, BookHash
from app.models.reading import (
    ReadingProgress,
    ReadingSession,
    UnmatchedKOReaderEntry,
    UnmatchedSession,
)

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
        # stats_book.md5 is KOReader's partial MD5 — match against our stored partial MD5
        result = await session.execute(select(Book).where(Book.file_hash_md5_ko == stats_book.md5))
        book = result.scalar_one_or_none()
        if book:
            return book

        # Match historical KOReader partial MD5s
        result = await session.execute(
            select(Book)
            .join(BookHash, Book.id == BookHash.book_id)
            .where(BookHash.hash_md5_ko == stats_book.md5)
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
            # Persist unmatched entry (skip if already recorded and not dismissed)
            existing_unmatched = await session.execute(
                select(UnmatchedKOReaderEntry).where(
                    UnmatchedKOReaderEntry.title == stats_book.title,
                    UnmatchedKOReaderEntry.source == "stats_db",
                )
            )
            book_sessions = sessions_by_book.get(stats_book.id, [])
            existing_entry = existing_unmatched.scalar_one_or_none()
            if existing_entry is None:
                entry = UnmatchedKOReaderEntry(
                    title=stats_book.title,
                    author=stats_book.authors,
                    source="stats_db",
                    source_path=str(db_path),
                    session_count=len(book_sessions),
                    total_duration_seconds=sum(s.duration for s in book_sessions),
                )
                session.add(entry)
                await session.flush()  # get entry.id
                for sess in book_sessions:
                    session.add(
                        UnmatchedSession(
                            unmatched_entry_id=entry.id,
                            start_time=sess.start_time,
                            duration=sess.duration,
                            pages_read=sess.pages_read,
                            source_key=sess.source_key,
                        )
                    )
            else:
                # Backfill any sessions not yet stored (handles entries created before this feature)
                existing_keys_result = await session.execute(
                    select(UnmatchedSession.source_key).where(
                        UnmatchedSession.unmatched_entry_id == existing_entry.id
                    )
                )
                existing_keys = {row[0] for row in existing_keys_result.all()}
                for sess in book_sessions:
                    if sess.source_key not in existing_keys:
                        session.add(
                            UnmatchedSession(
                                unmatched_entry_id=existing_entry.id,
                                start_time=sess.start_time,
                                duration=sess.duration,
                                pages_read=sess.pages_read,
                                source_key=sess.source_key,
                            )
                        )
            continue

        book_sessions = sessions_by_book.get(stats_book.id, [])

        if stats_book.ko_total_pages:
            shelfloom_book.page_count = stats_book.ko_total_pages

        # Upsert ReadingProgress with real last-read timestamp.
        # Use max_page_reached / ko_total_pages as the progress metric — this is the
        # furthest page reached, matching what KOReader's own stats plugin displays.
        # total_read_pages counts unique pages with logged time and is not equivalent
        # to reading position (e.g. a fresh device only knows its own sessions).
        if book_sessions and stats_book.ko_total_pages and stats_book.max_page_reached:
            last_sess = max(book_sessions, key=lambda s: s.start_time)
            last_end = last_sess.start_time + timedelta(seconds=last_sess.duration)
            progress_pct = round(stats_book.max_page_reached / stats_book.ko_total_pages * 100, 2)
            prog_result = await session.execute(
                select(ReadingProgress).where(
                    ReadingProgress.book_id == shelfloom_book.id,
                    ReadingProgress.device == "stats_db",
                )
            )
            prog_record = prog_result.scalar_one_or_none()
            if prog_record is None:
                prog_record = ReadingProgress(
                    book_id=shelfloom_book.id,
                    device="stats_db",
                )
                session.add(prog_record)
            prog_record.progress = progress_pct
            prog_record.updated_at = last_end

        for sess in book_sessions:
            # Check if already imported (including dismissed)
            existing = await session.execute(
                select(ReadingSession).where(ReadingSession.source_key == sess.source_key)
            )
            existing_session = existing.scalar_one_or_none()
            if existing_session is not None:
                # Repair stale imports from older logic that rescaled KOReader pages
                # into Shelfloom metadata page counts.
                if existing_session.source == "stats_db":
                    existing_session.start_time = sess.start_time
                    existing_session.duration = sess.duration
                    existing_session.pages_read = sess.pages_read
                skipped += 1
                continue

            reading_session = ReadingSession(
                book_id=shelfloom_book.id,
                start_time=sess.start_time,
                duration=sess.duration,
                pages_read=sess.pages_read,
                source="stats_db",
                source_key=sess.source_key,
                dismissed=False,
            )
            session.add(reading_session)
            imported += 1

    await session.commit()
    return {"imported": imported, "skipped": skipped, "unmatched": unmatched}
