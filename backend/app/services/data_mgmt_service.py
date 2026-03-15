"""Data management service — duplicate sessions, unmatched entries, book merging."""

from __future__ import annotations

import unicodedata
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookHash
from app.models.reading import (
    Highlight,
    ReadingProgress,
    ReadingSession,
    UnmatchedKOReaderEntry,
    UnmatchedSession,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _normalize_title(title: str) -> str:
    """Lowercase, strip accents, remove non-alphanumeric for fuzzy comparison."""
    nfkd = unicodedata.normalize("NFKD", title.lower())
    return "".join(c for c in nfkd if c.isalnum() or c.isspace()).strip()


def _session_out(rs: ReadingSession) -> dict:
    return {
        "id": rs.id,
        "book_id": rs.book_id,
        "start_time": rs.start_time.isoformat() if rs.start_time else None,
        "duration": rs.duration,
        "pages_read": rs.pages_read,
        "source": rs.source,
        "dismissed": rs.dismissed,
    }


# ---------------------------------------------------------------------------
# Duplicate Sessions
# ---------------------------------------------------------------------------

_TOLERANCE = timedelta(seconds=300)


async def get_duplicate_session_groups(session: AsyncSession) -> list[dict]:
    """
    Find books that have dismissed reading sessions.
    For each dismissed session, attempts to find the active counterpart within ±5 min.
    Returns groups keyed by book.
    """
    dismissed_result = await session.execute(
        select(ReadingSession, Book)
        .join(Book, ReadingSession.book_id == Book.id)
        .where(ReadingSession.dismissed == True)  # noqa: E712
        .order_by(Book.id, ReadingSession.start_time)
    )
    rows = dismissed_result.all()

    groups: dict[str, dict] = {}
    for dismissed_sess, book in rows:
        active_sess = None
        if dismissed_sess.start_time is not None:
            t_min = dismissed_sess.start_time - _TOLERANCE
            t_max = dismissed_sess.start_time + _TOLERANCE
            active_result = await session.execute(
                select(ReadingSession)
                .where(
                    ReadingSession.book_id == dismissed_sess.book_id,
                    ReadingSession.dismissed == False,  # noqa: E712
                    ReadingSession.start_time >= t_min,
                    ReadingSession.start_time <= t_max,
                )
                .limit(1)
            )
            active_sess = active_result.scalar_one_or_none()

        if book.id not in groups:
            groups[book.id] = {
                "book_id": book.id,
                "book_title": book.title,
                "book_author": book.author,
                "pairs": [],
            }
        groups[book.id]["pairs"].append(
            {
                "dismissed": _session_out(dismissed_sess),
                "active": _session_out(active_sess) if active_sess else None,
            }
        )

    return list(groups.values())


async def set_session_dismissed(session: AsyncSession, session_id: int, dismissed: bool) -> bool:
    """Set the dismissed flag on a session. Returns False if not found."""
    result = await session.execute(select(ReadingSession).where(ReadingSession.id == session_id))
    rs = result.scalar_one_or_none()
    if rs is None:
        return False
    rs.dismissed = dismissed
    await session.commit()
    return True


async def bulk_resolve_duplicates(session: AsyncSession) -> int:
    """
    Auto-dismiss SDR sessions that overlap with a stats_db session (±5 min) for all books.
    Returns total number of sessions dismissed.
    """
    from app.koreader.dedup import deduplicate_sessions

    book_ids_result = await session.execute(
        select(ReadingSession.book_id)
        .where(ReadingSession.source == "sdr", ReadingSession.dismissed == False)  # noqa: E712
        .distinct()
    )
    book_ids = [row[0] for row in book_ids_result.all()]

    total = 0
    for book_id in book_ids:
        total += await deduplicate_sessions(session, book_id)
    return total


# ---------------------------------------------------------------------------
# Unmatched KOReader Entries
# ---------------------------------------------------------------------------


async def get_unmatched_entries(
    session: AsyncSession, include_dismissed: bool = False
) -> list[UnmatchedKOReaderEntry]:
    q = select(UnmatchedKOReaderEntry).order_by(UnmatchedKOReaderEntry.created_at.desc())
    if not include_dismissed:
        q = q.where(UnmatchedKOReaderEntry.dismissed == False)  # noqa: E712
    result = await session.execute(q)
    return list(result.scalars().all())


async def link_unmatched_to_book(session: AsyncSession, entry_id: int, book_id: str) -> bool:
    """Link an unmatched entry to a book and mark it as dismissed (resolved)."""
    result = await session.execute(
        select(UnmatchedKOReaderEntry).where(UnmatchedKOReaderEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        return False

    # Verify book exists
    book_result = await session.execute(select(Book).where(Book.id == book_id))
    if book_result.scalar_one_or_none() is None:
        return False

    entry.linked_book_id = book_id
    entry.dismissed = True

    # Transfer stored unmatched sessions as real ReadingSession rows
    unmatched_sessions_result = await session.execute(
        select(UnmatchedSession).where(UnmatchedSession.unmatched_entry_id == entry_id)
    )
    for us in unmatched_sessions_result.scalars().all():
        if us.source_key:
            existing = await session.execute(
                select(ReadingSession).where(ReadingSession.source_key == us.source_key)
            )
            if existing.scalar_one_or_none() is not None:
                continue  # Already imported — skip

        session.add(
            ReadingSession(
                book_id=book_id,
                start_time=us.start_time,
                duration=us.duration,
                pages_read=us.pages_read,
                source="stats_db",
                source_key=us.source_key,
                dismissed=False,
            )
        )

    await session.commit()
    return True


async def dismiss_unmatched_entry(session: AsyncSession, entry_id: int) -> bool:
    """Dismiss an unmatched entry without linking it."""
    result = await session.execute(
        select(UnmatchedKOReaderEntry).where(UnmatchedKOReaderEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        return False
    entry.dismissed = True
    await session.commit()
    return True


# ---------------------------------------------------------------------------
# Duplicate Books
# ---------------------------------------------------------------------------


async def get_duplicate_book_groups(session: AsyncSession) -> list[dict]:
    """
    Find books with similar title+author (case-insensitive normalized match).
    Returns groups that have 2+ books.
    """
    result = await session.execute(
        select(
            Book,
        ).order_by(Book.author, Book.title)
    )
    books = list(result.scalars().all())

    # Build groups keyed by (normalized_author, normalized_title)
    groups: dict[tuple, list] = {}
    for book in books:
        norm_author = _normalize_title(book.author or "")
        norm_title = _normalize_title(book.title)
        key = (norm_author, norm_title)
        groups.setdefault(key, []).append(book)

    out = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        # Get session counts for each book
        book_dicts = []
        for book in group:
            count_result = await session.execute(
                select(ReadingSession.id).where(
                    ReadingSession.book_id == book.id,
                    ReadingSession.dismissed == False,  # noqa: E712
                )
            )
            session_count = len(count_result.all())
            book_dicts.append(
                {
                    "id": book.id,
                    "title": book.title,
                    "author": book.author,
                    "format": book.format,
                    "shelf_id": book.shelf_id,
                    "date_added": book.date_added.isoformat(),
                    "session_count": session_count,
                }
            )
        out.append({"books": book_dicts})
    return out


async def merge_books(session: AsyncSession, keep_id: str, discard_id: str) -> bool:
    """
    Merge discard book into keep book:
    - Move all reading sessions, highlights, reading_progress from discard → keep
    - Then delete discard (cascades series, tags, hashes, etc.)
    Returns False if either book not found or IDs are the same.
    """
    if keep_id == discard_id:
        return False

    keep_result = await session.execute(select(Book).where(Book.id == keep_id))
    keep_book = keep_result.scalar_one_or_none()
    discard_result = await session.execute(select(Book).where(Book.id == discard_id))
    discard_book = discard_result.scalar_one_or_none()
    if keep_book is None or discard_book is None:
        return False

    # Move reading sessions
    await session.execute(
        update(ReadingSession).where(ReadingSession.book_id == discard_id).values(book_id=keep_id)
    )

    # Move highlights
    await session.execute(
        update(Highlight).where(Highlight.book_id == discard_id).values(book_id=keep_id)
    )

    # Move reading progress (only if keep doesn't already have one for same device)
    discard_progress = await session.execute(
        select(ReadingProgress).where(ReadingProgress.book_id == discard_id)
    )
    for prog in discard_progress.scalars().all():
        existing = await session.execute(
            select(ReadingProgress).where(
                ReadingProgress.book_id == keep_id,
                ReadingProgress.device == prog.device,
            )
        )
        if existing.scalar_one_or_none() is None:
            prog.book_id = keep_id
        else:
            await session.delete(prog)

    # Delete discard book (cascades series, tags, hashes, etc.)
    await session.delete(discard_book)
    await session.commit()
    return True


# ---------------------------------------------------------------------------
# Import Log
# ---------------------------------------------------------------------------


async def get_import_log(
    session: AsyncSession, limit: int = 100, offset: int = 0, search: str | None = None
) -> dict:
    """Return recent book hash history entries (proxy for import activity)."""
    base_query = select(BookHash, Book).join(Book, BookHash.book_id == Book.id)
    if search:
        pattern = f"%{search}%"
        base_query = base_query.where(Book.title.ilike(pattern) | Book.author.ilike(pattern))

    total_result = await session.execute(base_query)
    total = len(total_result.all())

    result = await session.execute(
        base_query.order_by(BookHash.recorded_at.desc()).offset(offset).limit(limit)
    )
    rows = result.all()
    entries = [
        {
            "id": bh.id,
            "book_id": book.id,
            "book_title": book.title,
            "book_author": book.author,
            "hash_sha": bh.hash_sha[:12] + "…",
            "hash_md5": bh.hash_md5[:12] + "…",
            "page_count": bh.page_count,
            "recorded_at": bh.recorded_at.isoformat(),
        }
        for bh, book in rows
    ]
    return {"items": entries, "total": total, "limit": limit, "offset": offset}
