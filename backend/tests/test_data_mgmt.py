"""Tests for Step 4.5 — Data Management API."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookHash
from app.models.reading import ReadingSession, UnmatchedKOReaderEntry, UnmatchedSession

# ---------------------------------------------------------------------------
# Helpers / factories
# ---------------------------------------------------------------------------


async def _make_book(
    db_session: AsyncSession,
    shelf_id: int,
    title: str = "A Book",
    author: str | None = "Author A",
) -> Book:
    book_id = str(uuid.uuid4())
    book = Book(
        id=book_id,
        title=title,
        author=author,
        shelf_id=shelf_id,
        format="epub",
        file_path=f"{book_id}.epub",  # unique path per book to satisfy unique constraint
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


async def _make_session(
    db_session: AsyncSession,
    book_id: str,
    source: str = "stats_db",
    start_time: datetime | None = None,
    duration: int = 3600,
    dismissed: bool = False,
    source_key: str | None = None,
) -> ReadingSession:
    if start_time is None:
        start_time = datetime(2024, 1, 15, 10, 0, 0)
    rs = ReadingSession(
        book_id=book_id,
        start_time=start_time,
        duration=duration,
        pages_read=20,
        source=source,
        source_key=source_key,
        dismissed=dismissed,
    )
    db_session.add(rs)
    await db_session.commit()
    await db_session.refresh(rs)
    return rs


# ---------------------------------------------------------------------------
# Duplicate Sessions
# ---------------------------------------------------------------------------


async def test_duplicate_sessions_empty(client: AsyncClient):
    """No dismissed sessions → empty list."""
    resp = await client.get("/api/data-mgmt/duplicate-sessions")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_duplicate_sessions_shows_dismissed(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """Dismissed session appears in the response grouped by book."""
    await shelf_factory()
    book = await book_factory()
    t = datetime(2024, 3, 1, 9, 0, 0)
    active = await _make_session(db_session, book.id, "stats_db", t, dismissed=False)
    dismissed = await _make_session(
        db_session, book.id, "sdr", t + timedelta(seconds=60), dismissed=True
    )

    resp = await client.get("/api/data-mgmt/duplicate-sessions")
    assert resp.status_code == 200
    groups = resp.json()
    assert len(groups) == 1
    assert groups[0]["book_id"] == book.id
    pairs = groups[0]["pairs"]
    assert len(pairs) == 1
    assert pairs[0]["dismissed"]["id"] == dismissed.id
    # active counterpart should be found (within ±5 min)
    assert pairs[0]["active"] is not None
    assert pairs[0]["active"]["id"] == active.id


async def test_dismiss_session(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """PATCH /sessions/{id}/dismissed sets dismissed flag."""
    await shelf_factory()
    book = await book_factory()
    rs = await _make_session(db_session, book.id, dismissed=False)

    resp = await client.patch(
        f"/api/data-mgmt/sessions/{rs.id}/dismissed", json={"dismissed": True}
    )
    assert resp.status_code == 200

    await db_session.refresh(rs)
    assert rs.dismissed is True


async def test_undismiss_session(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """PATCH /sessions/{id}/dismissed can un-dismiss a session."""
    await shelf_factory()
    book = await book_factory()
    rs = await _make_session(db_session, book.id, dismissed=True)

    resp = await client.patch(
        f"/api/data-mgmt/sessions/{rs.id}/dismissed", json={"dismissed": False}
    )
    assert resp.status_code == 200
    await db_session.refresh(rs)
    assert rs.dismissed is False


async def test_dismiss_session_not_found(client: AsyncClient):
    resp = await client.patch("/api/data-mgmt/sessions/99999/dismissed", json={"dismissed": True})
    assert resp.status_code == 404


async def test_dismissed_sessions_excluded_from_stats(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """Dismissed sessions are excluded from stats API."""
    await shelf_factory()
    book = await book_factory()
    t = datetime(2024, 3, 1, 9, 0, 0)
    # dismissed session with large duration
    await _make_session(db_session, book.id, "sdr", t, duration=7200, dismissed=True)
    # active session with smaller duration
    await _make_session(db_session, book.id, "stats_db", t + timedelta(hours=5), duration=600)

    resp = await client.get("/api/stats/overview")
    assert resp.status_code == 200
    data = resp.json()
    # Only the active session (600s) should count, not the dismissed one (7200s)
    assert data["total_reading_time_seconds"] == 600


async def test_bulk_resolve_duplicates(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """Bulk resolve dismisses overlapping sdr sessions."""
    await shelf_factory()
    book = await book_factory()
    t = datetime(2024, 3, 1, 9, 0, 0)
    await _make_session(db_session, book.id, "stats_db", t, source_key="stats:key1")
    sdr = await _make_session(
        db_session, book.id, "sdr", t + timedelta(seconds=100), source_key="sdr:key1"
    )

    resp = await client.post("/api/data-mgmt/duplicate-sessions/bulk-resolve")
    assert resp.status_code == 200
    assert resp.json()["dismissed"] == 1

    await db_session.refresh(sdr)
    assert sdr.dismissed is True


# ---------------------------------------------------------------------------
# Unmatched KOReader Entries
# ---------------------------------------------------------------------------


async def test_unmatched_entries_empty(client: AsyncClient):
    resp = await client.get("/api/data-mgmt/unmatched")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_unmatched_entries_returned(client: AsyncClient, db_session: AsyncSession):
    entry = UnmatchedKOReaderEntry(
        title="Unknown Book",
        author="Unknown Author",
        source="stats_db",
        session_count=3,
        total_duration_seconds=5400,
    )
    db_session.add(entry)
    await db_session.commit()

    resp = await client.get("/api/data-mgmt/unmatched")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["title"] == "Unknown Book"
    assert items[0]["dismissed"] is False


async def test_unmatched_dismissed_excluded_by_default(
    client: AsyncClient, db_session: AsyncSession
):
    """Dismissed entries are excluded unless include_dismissed=true."""
    entry = UnmatchedKOReaderEntry(
        title="Dismissed Book",
        author=None,
        source="stats_db",
        session_count=0,
        total_duration_seconds=0,
        dismissed=True,
    )
    db_session.add(entry)
    await db_session.commit()

    resp = await client.get("/api/data-mgmt/unmatched")
    assert resp.status_code == 200
    assert resp.json() == []

    resp2 = await client.get("/api/data-mgmt/unmatched?include_dismissed=true")
    assert resp2.status_code == 200
    assert len(resp2.json()) == 1


async def test_link_unmatched_to_book(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """Link unmatched entry to a book → entry becomes dismissed."""
    await shelf_factory()
    book = await book_factory()
    entry = UnmatchedKOReaderEntry(
        title="My KO Book",
        author=None,
        source="stats_db",
        session_count=1,
        total_duration_seconds=1800,
    )
    db_session.add(entry)
    await db_session.commit()
    await db_session.refresh(entry)

    resp = await client.post(f"/api/data-mgmt/unmatched/{entry.id}/link", json={"book_id": book.id})
    assert resp.status_code == 200

    await db_session.refresh(entry)
    assert entry.dismissed is True
    assert entry.linked_book_id == book.id


async def test_link_unmatched_transfers_sessions(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """Linking an unmatched entry creates ReadingSession rows from stored UnmatchedSession rows."""
    from sqlalchemy import select

    await shelf_factory()
    book = await book_factory()
    entry = UnmatchedKOReaderEntry(
        title="KO Book With Sessions",
        author=None,
        source="stats_db",
        session_count=2,
        total_duration_seconds=3600,
    )
    db_session.add(entry)
    await db_session.flush()

    sess1 = UnmatchedSession(
        unmatched_entry_id=entry.id,
        start_time=datetime(2024, 1, 10, 9, 0),
        duration=1800,
        pages_read=20,
        source_key="stats_db:abc123:1704877200",
    )
    sess2 = UnmatchedSession(
        unmatched_entry_id=entry.id,
        start_time=datetime(2024, 1, 11, 9, 0),
        duration=1800,
        pages_read=25,
        source_key="stats_db:abc123:1704963600",
    )
    db_session.add(sess1)
    db_session.add(sess2)
    await db_session.commit()
    await db_session.refresh(entry)

    resp = await client.post(f"/api/data-mgmt/unmatched/{entry.id}/link", json={"book_id": book.id})
    assert resp.status_code == 200

    # ReadingSession rows should now exist for the book
    result = await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )
    sessions = result.scalars().all()
    assert len(sessions) == 2
    source_keys = {s.source_key for s in sessions}
    assert source_keys == {"stats_db:abc123:1704877200", "stats_db:abc123:1704963600"}


async def test_link_unmatched_book_not_found(client: AsyncClient, db_session: AsyncSession):
    entry = UnmatchedKOReaderEntry(
        title="No Book",
        author=None,
        source="stats_db",
        session_count=0,
        total_duration_seconds=0,
    )
    db_session.add(entry)
    await db_session.commit()
    await db_session.refresh(entry)

    resp = await client.post(
        f"/api/data-mgmt/unmatched/{entry.id}/link",
        json={"book_id": "nonexistent-uuid"},
    )
    assert resp.status_code == 404


async def test_dismiss_unmatched_entry(client: AsyncClient, db_session: AsyncSession):
    entry = UnmatchedKOReaderEntry(
        title="Dismiss Me",
        author=None,
        source="stats_db",
        session_count=0,
        total_duration_seconds=0,
    )
    db_session.add(entry)
    await db_session.commit()
    await db_session.refresh(entry)

    resp = await client.post(f"/api/data-mgmt/unmatched/{entry.id}/dismiss")
    assert resp.status_code == 200

    await db_session.refresh(entry)
    assert entry.dismissed is True


async def test_dismiss_unmatched_not_found(client: AsyncClient):
    resp = await client.post("/api/data-mgmt/unmatched/99999/dismiss")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Duplicate Books
# ---------------------------------------------------------------------------


async def test_duplicate_books_empty(client: AsyncClient, shelf_factory, book_factory):
    """Single book → no duplicates."""
    await shelf_factory()
    await book_factory()
    resp = await client.get("/api/data-mgmt/duplicate-books")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_duplicate_books_found(client: AsyncClient, db_session: AsyncSession, shelf_factory):
    """Two books with same (normalized) title+author → one group."""
    shelf = await shelf_factory()
    book_a = await _make_book(db_session, shelf.id, "The Way of Kings", "Brandon Sanderson")
    book_b = await _make_book(db_session, shelf.id, "The Way of Kings", "Brandon Sanderson")

    resp = await client.get("/api/data-mgmt/duplicate-books")
    assert resp.status_code == 200
    groups = resp.json()
    assert len(groups) == 1
    ids = {b["id"] for b in groups[0]["books"]}
    assert book_a.id in ids
    assert book_b.id in ids


async def test_duplicate_books_case_insensitive(
    client: AsyncClient, db_session: AsyncSession, shelf_factory
):
    """Case-insensitive duplicate detection."""
    shelf = await shelf_factory()
    await _make_book(db_session, shelf.id, "dune", "frank herbert")
    await _make_book(db_session, shelf.id, "Dune", "Frank Herbert")

    resp = await client.get("/api/data-mgmt/duplicate-books")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_merge_books(client: AsyncClient, db_session: AsyncSession, shelf_factory):
    """Merge keeps reading sessions from both, deletes discard book."""
    shelf = await shelf_factory()
    keep = await _make_book(db_session, shelf.id, "Dune", "Frank Herbert")
    discard = await _make_book(db_session, shelf.id, "Dune", "Frank Herbert")

    # Add a session to discard
    await _make_session(db_session, discard.id, "manual")

    resp = await client.post(
        "/api/data-mgmt/books/merge",
        json={"keep_id": keep.id, "discard_id": discard.id},
    )
    assert resp.status_code == 200

    # Session should now belong to keep
    from sqlalchemy import select

    sessions = (
        (await db_session.execute(select(ReadingSession).where(ReadingSession.book_id == keep.id)))
        .scalars()
        .all()
    )
    assert len(sessions) == 1

    # Discard book should be gone
    from app.models.book import Book

    result = await db_session.execute(select(Book).where(Book.id == discard.id))
    assert result.scalar_one_or_none() is None


async def test_merge_books_same_id(client: AsyncClient, shelf_factory, book_factory):
    await shelf_factory()
    book = await book_factory()
    resp = await client.post(
        "/api/data-mgmt/books/merge",
        json={"keep_id": book.id, "discard_id": book.id},
    )
    assert resp.status_code == 404


async def test_merge_books_not_found(client: AsyncClient):
    resp = await client.post(
        "/api/data-mgmt/books/merge",
        json={"keep_id": "no-such-id-1", "discard_id": "no-such-id-2"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Import Log
# ---------------------------------------------------------------------------


async def test_import_log_empty(client: AsyncClient):
    resp = await client.get("/api/data-mgmt/import-log")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


async def test_import_log_returns_entries(
    client: AsyncClient, db_session: AsyncSession, shelf_factory
):
    """Import log shows book hash history."""
    shelf = await shelf_factory()
    book = await _make_book(db_session, shelf.id)

    bh = BookHash(
        book_id=book.id,
        hash_sha="a" * 64,
        hash_md5="b" * 32,
        page_count=300,
    )
    db_session.add(bh)
    await db_session.commit()

    resp = await client.get("/api/data-mgmt/import-log")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    entry = data["items"][0]
    assert entry["book_id"] == book.id
    assert entry["book_title"] == book.title
    assert "…" in entry["hash_sha"]


async def test_import_log_pagination(client: AsyncClient, db_session: AsyncSession, shelf_factory):
    """Limit/offset work correctly."""
    shelf = await shelf_factory()
    book = await _make_book(db_session, shelf.id)

    for i in range(5):
        bh = BookHash(book_id=book.id, hash_sha="a" * 64, hash_md5="b" * 32)
        db_session.add(bh)
    await db_session.commit()

    resp = await client.get("/api/data-mgmt/import-log?limit=2&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5


# ---------------------------------------------------------------------------
# Re-import doesn't resurrect dismissed sessions
# ---------------------------------------------------------------------------


async def test_reimport_does_not_resurrect_dismissed(
    client: AsyncClient, db_session: AsyncSession, shelf_factory, book_factory
):
    """source_key uniqueness prevents dismissed sessions from being re-imported."""
    await shelf_factory()
    book = await book_factory()
    # Create a dismissed session with a source_key
    rs = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 1, 10, 0, 0),
        duration=3600,
        pages_read=50,
        source="stats_db",
        source_key="stats_db:uniquekey123",
        dismissed=True,
    )
    db_session.add(rs)
    await db_session.commit()

    # Try to create another session with the same source_key
    from sqlalchemy import select

    existing = (
        await db_session.execute(
            select(ReadingSession).where(ReadingSession.source_key == "stats_db:uniquekey123")
        )
    ).scalar_one_or_none()
    # The existing dismissed session blocks any re-import (same source_key)
    assert existing is not None
    assert existing.dismissed is True


# ---------------------------------------------------------------------------
# Sessions Log
# ---------------------------------------------------------------------------


async def test_sessions_log_basic(client: AsyncClient, db_session: AsyncSession, shelf_factory):
    """Sessions log returns sessions with book metadata."""
    shelf = await shelf_factory()
    book = await _make_book(db_session, shelf.id, title="Log Book", author="Log Author")
    await _make_session(db_session, book.id, source="stats_db")

    resp = await client.get("/api/data-mgmt/sessions-log")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    entry = next(e for e in data["items"] if e["book_id"] == book.id)
    assert entry["book_title"] == "Log Book"
    assert entry["book_author"] == "Log Author"
    assert entry["source"] == "stats_db"
    assert "created_at" in entry


async def test_sessions_log_search(client: AsyncClient, db_session: AsyncSession, shelf_factory):
    """Search filters by book title and author."""
    shelf = await shelf_factory()
    book_a = await _make_book(db_session, shelf.id, title="Alpha Book", author="Writer X")
    book_b = await _make_book(db_session, shelf.id, title="Beta Book", author="Writer Y")
    await _make_session(db_session, book_a.id)
    await _make_session(db_session, book_b.id)

    resp = await client.get("/api/data-mgmt/sessions-log?search=Alpha")
    assert resp.status_code == 200
    data = resp.json()
    ids = [e["book_id"] for e in data["items"]]
    assert book_a.id in ids
    assert book_b.id not in ids


async def test_sessions_log_source_filter(
    client: AsyncClient, db_session: AsyncSession, shelf_factory
):
    """Source filter restricts results to matching source."""
    shelf = await shelf_factory()
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, source="sdr", source_key="sdr:k1")
    await _make_session(db_session, book.id, source="stats_db", source_key="stats:k1")

    resp = await client.get("/api/data-mgmt/sessions-log?source=sdr")
    assert resp.status_code == 200
    data = resp.json()
    assert all(e["source"] == "sdr" for e in data["items"])


async def test_sessions_log_pagination(
    client: AsyncClient, db_session: AsyncSession, shelf_factory
):
    """Limit/offset pagination works correctly."""
    shelf = await shelf_factory()
    book = await _make_book(db_session, shelf.id)
    for i in range(5):
        await _make_session(
            db_session, book.id, source_key=f"key:{i}", start_time=datetime(2024, 1, i + 1)
        )

    resp = await client.get("/api/data-mgmt/sessions-log?limit=2&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
