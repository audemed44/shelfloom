"""Tests for cross-source session deduplication (step 2.4)."""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.models.reading import ReadingSession


async def _make_session(
    db_session,
    book_id: str,
    start_time: datetime,
    source: str,
    source_key: str,
    dismissed: bool = False,
) -> ReadingSession:
    sess = ReadingSession(
        book_id=book_id,
        start_time=start_time,
        duration=300,
        pages_read=10,
        source=source,
        source_key=source_key,
        dismissed=dismissed,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def test_dedup_same_session_both_sources(db_session, book_factory, shelf_factory):
    """sdr session matching stats_db session → sdr dismissed."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    t = datetime(2024, 1, 15, 10, 0, 0)
    stats_sess = await _make_session(db_session, book.id, t, "stats_db", "stats_db:md5:1000")
    sdr_sess = await _make_session(db_session, book.id, t, "sdr", "sdr:md5:1000")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 1

    # Refresh
    await db_session.refresh(sdr_sess)
    await db_session.refresh(stats_sess)
    assert sdr_sess.dismissed is True
    assert stats_sess.dismissed is False


async def test_dedup_within_tolerance(db_session, book_factory, shelf_factory):
    """Sessions within tolerance window → sdr dismissed."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    from datetime import timedelta
    t1 = datetime(2024, 1, 15, 10, 0, 0)
    t2 = t1 + timedelta(seconds=200)  # within 300s tolerance

    await _make_session(db_session, book.id, t1, "stats_db", "stats_db:md5:2000")
    sdr_sess = await _make_session(db_session, book.id, t2, "sdr", "sdr:md5:2200")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 1

    await db_session.refresh(sdr_sess)
    assert sdr_sess.dismissed is True


async def test_dedup_outside_tolerance(db_session, book_factory, shelf_factory):
    """Sessions outside tolerance → both kept."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    from datetime import timedelta
    t1 = datetime(2024, 1, 15, 10, 0, 0)
    t2 = t1 + timedelta(seconds=600)  # 10 min apart, > 300s tolerance

    await _make_session(db_session, book.id, t1, "stats_db", "stats_db:md5:3000")
    sdr_sess = await _make_session(db_session, book.id, t2, "sdr", "sdr:md5:3600")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 0

    await db_session.refresh(sdr_sess)
    assert sdr_sess.dismissed is False


async def test_dedup_at_tolerance_boundary(db_session, book_factory, shelf_factory):
    """Session exactly at tolerance boundary (300s) → deduped."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    from datetime import timedelta
    t1 = datetime(2024, 1, 15, 10, 0, 0)
    t2 = t1 + timedelta(seconds=300)  # exactly at boundary

    await _make_session(db_session, book.id, t1, "stats_db", "stats_db:md5:4000")
    sdr_sess = await _make_session(db_session, book.id, t2, "sdr", "sdr:md5:4300")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 1

    await db_session.refresh(sdr_sess)
    assert sdr_sess.dismissed is True


async def test_dedup_no_duplicates_non_overlapping(db_session, book_factory, shelf_factory):
    """Non-overlapping sessions → both kept."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    from datetime import timedelta
    t1 = datetime(2024, 1, 15, 8, 0, 0)
    t2 = datetime(2024, 1, 15, 20, 0, 0)

    await _make_session(db_session, book.id, t1, "stats_db", "stats_db:md5:5000")
    sdr_sess = await _make_session(db_session, book.id, t2, "sdr", "sdr:md5:72000")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 0

    await db_session.refresh(sdr_sess)
    assert sdr_sess.dismissed is False


async def test_dedup_stats_db_preferred(db_session, book_factory, shelf_factory):
    """stats_db is never dismissed — only sdr gets dismissed."""
    from app.koreader.dedup import deduplicate_sessions

    await shelf_factory()
    book = await book_factory()

    t = datetime(2024, 1, 15, 10, 0, 0)
    stats_sess = await _make_session(db_session, book.id, t, "stats_db", "stats_db:md5:6000")
    sdr_sess = await _make_session(db_session, book.id, t, "sdr", "sdr:md5:6000")

    count = await deduplicate_sessions(db_session, book.id)
    assert count == 1

    await db_session.refresh(stats_sess)
    await db_session.refresh(sdr_sess)
    assert stats_sess.dismissed is False
    assert sdr_sess.dismissed is True
