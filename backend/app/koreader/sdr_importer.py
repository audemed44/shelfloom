"""Map .sdr data to Shelfloom models and persist."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.koreader.sdr_reader import SdrReadingData
from app.models.book import Book, BookHash
from app.models.reading import Highlight, ReadingProgress, ReadingSession

log = logging.getLogger(__name__)

# Gap threshold in seconds for splitting sessions
SESSION_GAP_SECONDS = 600  # 10 minutes


def _aggregate_sessions(
    performance_in_pages: dict[int, int],
    partial_md5: str | None,
    doc_path: str | None,
) -> list[dict]:
    """
    Group performance_in_pages into sessions based on time gaps.
    Returns list of dicts with: start_time, duration, pages_read, source_key
    """
    if not performance_in_pages:
        return []

    sorted_ts = sorted(performance_in_pages.keys())
    sessions: list[dict] = []
    current_group: list[int] = [sorted_ts[0]]

    for ts in sorted_ts[1:]:
        prev_ts = current_group[-1]
        if ts - prev_ts > SESSION_GAP_SECONDS:
            sessions.append(_build_session(current_group, performance_in_pages, partial_md5, doc_path))
            current_group = [ts]
        else:
            current_group.append(ts)

    # Don't forget the last group
    sessions.append(_build_session(current_group, performance_in_pages, partial_md5, doc_path))
    return sessions


def _build_session(
    group: list[int],
    performance_in_pages: dict[int, int],
    partial_md5: str | None,
    doc_path: str | None,
) -> dict:
    start_ts = group[0]
    end_ts = group[-1]
    pages_read = sum(performance_in_pages[ts] for ts in group)

    # Estimate duration: from first to last timestamp
    # Add an estimated minute for the last page
    if len(group) > 1:
        duration = end_ts - start_ts + 60
    else:
        # Single timestamp — estimate 1 minute per page
        duration = max(60, pages_read * 60)

    start_dt = datetime.fromtimestamp(start_ts, tz=timezone.utc).replace(tzinfo=None)

    # Build source key
    if partial_md5:
        source_key = f"sdr:{partial_md5}:{start_ts}"
    elif doc_path:
        source_key = f"sdr:path:{doc_path}:{start_ts}"
    else:
        source_key = f"sdr:unknown:{start_ts}"

    return {
        "start_time": start_dt,
        "duration": duration,
        "pages_read": pages_read,
        "source_key": source_key,
    }


async def import_sdr(
    session: AsyncSession,
    book: Book,
    sdr_data: SdrReadingData,
) -> dict[str, int]:
    """
    Persist reading data from a parsed .sdr into the DB.
    Returns counts: {"sessions": N, "highlights": N, "progress": 1|0}
    Skips already-imported sessions (by source_key).
    Dismissed sessions stay dismissed (not re-imported).
    """
    counts = {"sessions": 0, "highlights": 0, "progress": 0}

    # Upsert reading progress
    result = await session.execute(
        select(ReadingProgress).where(
            ReadingProgress.book_id == book.id,
            ReadingProgress.device == "sdr",
        )
    )
    progress_record = result.scalar_one_or_none()
    if progress_record is None:
        progress_record = ReadingProgress(
            book_id=book.id,
            device="sdr",
        )
        session.add(progress_record)

    if sdr_data.percent_finished is not None:
        progress_record.progress = round(sdr_data.percent_finished * 100, 2)
        counts["progress"] = 1
    if sdr_data.last_xpointer:
        progress_record.position = sdr_data.last_xpointer

    # Import sessions
    aggregated = _aggregate_sessions(
        sdr_data.performance_in_pages,
        sdr_data.partial_md5,
        sdr_data.doc_path,
    )

    # Set updated_at to the real last-read timestamp rather than import time
    if aggregated:
        last_sess = max(aggregated, key=lambda s: s["start_time"])
        progress_record.updated_at = last_sess["start_time"] + timedelta(
            seconds=last_sess["duration"]
        )

    for sess_data in aggregated:
        source_key = sess_data["source_key"]
        # Check if already imported (including dismissed)
        existing = await session.execute(
            select(ReadingSession).where(ReadingSession.source_key == source_key)
        )
        if existing.scalar_one_or_none() is not None:
            continue  # Already exists (dismissed or not) — skip

        reading_session = ReadingSession(
            book_id=book.id,
            start_time=sess_data["start_time"],
            duration=sess_data["duration"],
            pages_read=sess_data["pages_read"],
            source="sdr",
            source_key=source_key,
            dismissed=False,
        )
        session.add(reading_session)
        counts["sessions"] += 1

    # Import highlights
    for ann in sdr_data.annotations:
        # Check for duplicate by book + text + page
        existing_hl = await session.execute(
            select(Highlight).where(
                Highlight.book_id == book.id,
                Highlight.text == ann.text,
                Highlight.page == ann.page,
            )
        )
        if existing_hl.scalar_one_or_none() is not None:
            continue

        highlight = Highlight(
            book_id=book.id,
            text=ann.text,
            note=ann.note,
            chapter=ann.chapter,
            page=ann.page,
            created=ann.datetime,
        )
        session.add(highlight)
        counts["highlights"] += 1

    await session.commit()
    return counts


async def find_book_for_sdr(
    session: AsyncSession,
    sdr_data: SdrReadingData,
    sdr_folder: Path,
) -> Book | None:
    """
    Match an SdrReadingData to a Book in the database.
    Strategy:
    1. Match by file path: book file = sdr_folder.parent / sdr_folder.name.removesuffix('.sdr')
    2. Match by partial MD5 (check books.file_hash_md5 and book_hashes.hash_md5 STARTS WITH partial_md5)
    3. Match by title+author
    """
    # Strategy 1: Match by file path
    book_filename = sdr_folder.name.removesuffix(".sdr")
    book_file = sdr_folder.parent / book_filename
    if book_file.exists():
        result = await session.execute(
            select(Book).where(Book.file_path.endswith(book_filename))
        )
        book = result.scalar_one_or_none()
        if book:
            return book

    # Strategy 2: Match by partial MD5
    if sdr_data.partial_md5:
        partial = sdr_data.partial_md5
        # Check current hash on books table
        result = await session.execute(
            select(Book).where(Book.file_hash_md5.startswith(partial))
        )
        book = result.scalar_one_or_none()
        if book:
            return book
        # Check historical hashes
        result = await session.execute(
            select(Book).join(BookHash, Book.id == BookHash.book_id).where(
                BookHash.hash_md5.startswith(partial)
            )
        )
        book = result.scalar_one_or_none()
        if book:
            return book

    # Strategy 3: Match by title + author
    if sdr_data.title and sdr_data.authors:
        result = await session.execute(
            select(Book).where(
                Book.title == sdr_data.title,
                Book.author == sdr_data.authors,
            )
        )
        book = result.scalar_one_or_none()
        if book:
            return book

    return None
