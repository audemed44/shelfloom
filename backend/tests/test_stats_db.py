"""Tests for KOReader statistics.sqlite3 reader and importer (step 2.3)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.reading import ReadingSession


def _create_stats_db(path: Path, books=None, page_stats=None) -> Path:
    """Create a test KOReader statistics.sqlite3."""
    conn = sqlite3.connect(str(path))
    conn.execute("""
        CREATE TABLE book (
            id INTEGER PRIMARY KEY,
            title TEXT,
            authors TEXT,
            md5 TEXT,
            series TEXT,
            language TEXT,
            total_read_time INTEGER,
            total_read_pages INTEGER,
            last_open INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        )
    """)

    if books:
        conn.executemany(
            "INSERT INTO book (id, title, authors, md5, series, language, "
            "total_read_time, total_read_pages, last_open) VALUES (?,?,?,?,?,?,?,?,?)",
            books,
        )
    if page_stats:
        conn.executemany(
            "INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) "
            "VALUES (?,?,?,?,?)",
            page_stats,
        )
    conn.commit()
    conn.close()
    return path


# ── stats_db_reader ───────────────────────────────────────────────────────────


def test_read_stats_db_basic(tmp_path):
    """Read basic stats DB — books and sessions returned."""
    from app.koreader.stats_db_reader import read_stats_db

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, "My Book", "Author A", "md5abc", None, "en", 3600, 100, 1705359000)],
        page_stats=[
            (1, 1, 1705359000, 60, 300),
            (1, 2, 1705359060, 55, 300),
            (1, 3, 1705359120, 50, 300),
        ],
    )

    books, sessions_by_book = read_stats_db(db)
    assert len(books) == 1
    assert books[0].title == "My Book"
    assert books[0].md5 == "md5abc"

    assert 1 in sessions_by_book
    sessions = sessions_by_book[1]
    assert len(sessions) == 1
    assert sessions[0].pages_read == 3  # 3 distinct pages
    assert sessions[0].duration == 165  # 60+55+50


def test_read_stats_db_session_gap(tmp_path):
    """Gap > 10 min → 2 sessions."""
    from app.koreader.stats_db_reader import read_stats_db

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, "Book", "Author", "md5x", None, None, 0, 0, 0)],
        page_stats=[
            (1, 1, 1705359000, 60, 100),
            (1, 2, 1705359060, 60, 100),
            (1, 3, 1705365700, 60, 100),  # >10 min gap from end of prev
        ],
    )

    _, sessions_by_book = read_stats_db(db)
    sessions = sessions_by_book[1]
    assert len(sessions) == 2


def test_read_stats_db_close_sessions(tmp_path):
    """Rows within 10 min → 1 session."""
    from app.koreader.stats_db_reader import read_stats_db

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, "Book", "Author", "md5y", None, None, 0, 0, 0)],
        page_stats=[
            (1, 1, 1705359000, 30, 100),
            (1, 2, 1705359030, 30, 100),
            (1, 3, 1705359060, 30, 100),
        ],
    )

    _, sessions_by_book = read_stats_db(db)
    sessions = sessions_by_book[1]
    assert len(sessions) == 1


def test_read_stats_db_empty(tmp_path):
    """Empty DB returns empty lists."""
    from app.koreader.stats_db_reader import read_stats_db

    db = _create_stats_db(tmp_path / "statistics.sqlite3")
    books, sessions = read_stats_db(db)
    assert books == []
    assert sessions == {}


def test_read_stats_db_not_found(tmp_path):
    """FileNotFoundError when DB doesn't exist."""
    from app.koreader.stats_db_reader import read_stats_db

    with pytest.raises(FileNotFoundError):
        read_stats_db(tmp_path / "missing.sqlite3")


# ── stats_db_importer ─────────────────────────────────────────────────────────


async def test_import_stats_db_by_md5(tmp_path, db_session, book_factory, shelf_factory):
    """Match and import by MD5."""
    from app.koreader.stats_db_importer import import_stats_db

    await shelf_factory()
    book = await book_factory()
    book.file_hash_md5 = "aabbccdd"
    await db_session.commit()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, book.title, book.author, "aabbccdd", None, None, 0, 0, 0)],
        page_stats=[(1, 1, 1705359000, 60, 100)],
    )

    result = await import_stats_db(db_session, db)
    assert result["imported"] == 1
    assert result["unmatched"] == []

    sessions = (await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )).scalars().all()
    assert len(sessions) == 1
    assert sessions[0].source == "stats_db"


async def test_import_stats_db_by_historical_md5(tmp_path, db_session, book_factory, shelf_factory):
    """Match by historical MD5 from book_hashes."""
    from app.koreader.stats_db_importer import import_stats_db
    from app.models.book import BookHash

    await shelf_factory()
    book = await book_factory()
    # Add historical hash
    bh = BookHash(book_id=book.id, hash_sha="sha123", hash_md5="hist_md5_abc")
    db_session.add(bh)
    await db_session.commit()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, book.title, book.author, "hist_md5_abc", None, None, 0, 0, 0)],
        page_stats=[(1, 1, 1705359000, 60, 100)],
    )

    result = await import_stats_db(db_session, db)
    assert result["imported"] == 1


async def test_import_stats_db_unmatched(tmp_path, db_session, book_factory, shelf_factory):
    """Unmatched book returned in unmatched list."""
    from app.koreader.stats_db_importer import import_stats_db

    await shelf_factory()
    await book_factory()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, "Unknown Book", "Unknown Author", "zzz999", None, None, 0, 0, 0)],
        page_stats=[(1, 1, 1705359000, 60, 100)],
    )

    result = await import_stats_db(db_session, db)
    assert "Unknown Book" in result["unmatched"]
    assert result["imported"] == 0


async def test_import_stats_db_no_duplicates(tmp_path, db_session, book_factory, shelf_factory):
    """Re-import → no duplicates."""
    from app.koreader.stats_db_importer import import_stats_db

    await shelf_factory()
    book = await book_factory()
    book.file_hash_md5 = "dedupe_md5"
    await db_session.commit()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, book.title, book.author, "dedupe_md5", None, None, 0, 0, 0)],
        page_stats=[(1, 1, 1705359000, 60, 100)],
    )

    await import_stats_db(db_session, db)
    result2 = await import_stats_db(db_session, db)
    assert result2["imported"] == 0
    assert result2["skipped"] == 1


async def test_import_stats_db_dismissed_stays_dismissed(tmp_path, db_session, book_factory, shelf_factory):
    """Dismissed session not re-imported."""
    from app.koreader.stats_db_importer import import_stats_db

    await shelf_factory()
    book = await book_factory()
    book.file_hash_md5 = "dism_md5"
    await db_session.commit()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[(1, book.title, book.author, "dism_md5", None, None, 0, 0, 0)],
        page_stats=[(1, 1, 1705359000, 60, 100)],
    )

    await import_stats_db(db_session, db)

    # Dismiss the session
    sess = (await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )).scalar_one()
    sess.dismissed = True
    await db_session.commit()

    result2 = await import_stats_db(db_session, db)
    assert result2["imported"] == 0

    sessions = (await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )).scalars().all()
    assert len(sessions) == 1
    assert sessions[0].dismissed is True


async def test_import_stats_db_multiple_books_same_shelfloom_book(
    tmp_path, db_session, book_factory, shelf_factory
):
    """Multiple stats DB books mapping to same Shelfloom book → sessions merged."""
    from app.koreader.stats_db_importer import import_stats_db

    await shelf_factory()
    book = await book_factory(title="My Book", author="Author X")
    book.file_hash_md5 = "hash_primary"
    from app.models.book import BookHash
    bh = BookHash(book_id=book.id, hash_sha="sha_hist", hash_md5="hash_historical")
    db_session.add(bh)
    await db_session.commit()

    db = _create_stats_db(
        tmp_path / "statistics.sqlite3",
        books=[
            (1, "My Book", "Author X", "hash_primary", None, None, 0, 0, 0),
            (2, "My Book", "Author X", "hash_historical", None, None, 0, 0, 0),
        ],
        page_stats=[
            (1, 1, 1705359000, 60, 100),
            (2, 1, 1705369000, 60, 100),
        ],
    )

    result = await import_stats_db(db_session, db)
    assert result["imported"] == 2

    sessions = (await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )).scalars().all()
    assert len(sessions) == 2
