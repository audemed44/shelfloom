"""Tests for reading data API (step 2.7)."""

from __future__ import annotations

from datetime import datetime


async def _create_book(client, db_session):
    """Helper to create a shelf + book via DB."""
    import uuid

    from app.models.book import Book
    from app.models.shelf import Shelf

    shelf = Shelf(name="Test Shelf", path="/shelves/test")
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(uuid.uuid4()),
        title="Test Book",
        author="Test Author",
        format="epub",
        file_path="test.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


# ── highlights endpoint ───────────────────────────────────────────────────────


async def test_get_highlights_empty(client, db_session):
    """Highlights endpoint returns empty list when no highlights."""
    book = await _create_book(client, db_session)

    resp = await client.get(f"/api/books/{book.id}/highlights")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_get_highlights_with_data(client, db_session):
    """Highlights endpoint returns correct data."""
    from app.models.reading import Highlight

    book = await _create_book(client, db_session)

    h1 = Highlight(book_id=book.id, text="First highlight", page=5, chapter="Ch 1")
    h2 = Highlight(book_id=book.id, text="Second highlight", page=10, note="A note")
    db_session.add_all([h1, h2])
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/highlights")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2
    texts = {item["text"] for item in data["items"]}
    assert "First highlight" in texts
    assert "Second highlight" in texts


async def test_get_highlights_pagination(client, db_session):
    """Highlights endpoint is paginated."""
    from app.models.reading import Highlight

    book = await _create_book(client, db_session)

    for i in range(5):
        db_session.add(Highlight(book_id=book.id, text=f"Highlight {i}", page=i))
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/highlights?page=1&per_page=2")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["pages"] == 3


async def test_get_highlights_unknown_book(client):
    """Highlights endpoint returns 404 for unknown book."""
    resp = await client.get("/api/books/nonexistent-id/highlights")
    assert resp.status_code == 404


# ── sessions endpoint ─────────────────────────────────────────────────────────


async def test_get_sessions_empty(client, db_session):
    """Sessions endpoint returns empty list when no sessions."""
    book = await _create_book(client, db_session)

    resp = await client.get(f"/api/books/{book.id}/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_get_sessions_excludes_dismissed(client, db_session):
    """Sessions endpoint excludes dismissed sessions."""
    from app.models.reading import ReadingSession

    book = await _create_book(client, db_session)

    active = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 15, 10, 0),
        duration=300,
        pages_read=10,
        source="sdr",
        source_key="sdr:md5:active",
        dismissed=False,
    )
    dismissed = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 14, 10, 0),
        duration=300,
        pages_read=5,
        source="sdr",
        source_key="sdr:md5:dismissed",
        dismissed=True,
    )
    db_session.add_all([active, dismissed])
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["source"] == "sdr"
    assert data["items"][0]["dismissed"] is False


async def test_get_sessions_pagination(client, db_session):
    """Sessions endpoint is paginated."""
    from app.models.reading import ReadingSession

    book = await _create_book(client, db_session)

    for i in range(5):
        db_session.add(
            ReadingSession(
                book_id=book.id,
                start_time=datetime(2024, 1, i + 1, 10, 0),
                duration=300,
                pages_read=10,
                source="sdr",
                source_key=f"sdr:md5:sess{i}",
                dismissed=False,
            )
        )
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/sessions?page=1&per_page=3")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3
    assert data["total"] == 5
    assert data["pages"] == 2


async def test_get_sessions_unknown_book(client):
    """Sessions endpoint returns 404 for unknown book."""
    resp = await client.get("/api/books/nonexistent-id/sessions")
    assert resp.status_code == 404


# ── progress endpoint ─────────────────────────────────────────────────────────


async def test_get_progress_empty(client, db_session):
    """Progress endpoint returns empty list when no progress."""
    book = await _create_book(client, db_session)

    resp = await client.get(f"/api/books/{book.id}/progress")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_progress_per_device(client, db_session):
    """Progress endpoint returns progress for all devices."""
    from app.models.reading import ReadingProgress

    book = await _create_book(client, db_session)

    p1 = ReadingProgress(book_id=book.id, device="Kindle", progress=0.5)
    p2 = ReadingProgress(book_id=book.id, device="Kobo", progress=0.7)
    db_session.add_all([p1, p2])
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/progress")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    devices = {item["device"] for item in data}
    assert "Kindle" in devices
    assert "Kobo" in devices


async def test_get_progress_unknown_book(client):
    """Progress endpoint returns 404 for unknown book."""
    resp = await client.get("/api/books/nonexistent-id/progress")
    assert resp.status_code == 404


# ── reading summary endpoint ──────────────────────────────────────────────────


async def test_reading_summary_empty(client, db_session):
    """Reading summary returns zeros when no data."""
    book = await _create_book(client, db_session)

    resp = await client.get(f"/api/books/{book.id}/reading-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_sessions"] == 0
    assert data["total_time_seconds"] == 0
    assert data["percent_finished"] is None


async def test_reading_summary_with_data(client, db_session):
    """Reading summary returns correct totals."""
    from app.models.reading import ReadingProgress, ReadingSession

    book = await _create_book(client, db_session)

    s1 = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 15, 10, 0),
        duration=3600,
        pages_read=50,
        source="sdr",
        source_key="sdr:md5:s1",
        dismissed=False,
    )
    s2 = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 16, 10, 0),
        duration=1800,
        pages_read=25,
        source="sdr",
        source_key="sdr:md5:s2",
        dismissed=False,
    )
    dismissed = ReadingSession(
        book_id=book.id,
        start_time=datetime(2024, 1, 14, 10, 0),
        duration=9999,
        pages_read=100,
        source="sdr",
        source_key="sdr:md5:dismissed",
        dismissed=True,
    )
    progress = ReadingProgress(book_id=book.id, device="sdr", progress=0.73)
    db_session.add_all([s1, s2, dismissed, progress])
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/reading-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_sessions"] == 2  # dismissed excluded
    assert data["total_time_seconds"] == 5400  # 3600 + 1800
    assert abs(data["percent_finished"] - 0.73) < 0.001


async def test_reading_summary_unknown_book(client):
    """Reading summary returns 404 for unknown book."""
    resp = await client.get("/api/books/nonexistent-id/reading-summary")
    assert resp.status_code == 404


async def test_mark_dnf_and_clear(client, db_session):
    book = await _create_book(client, db_session)

    mark_resp = await client.post(f"/api/books/{book.id}/dnf")
    assert mark_resp.status_code == 200

    detail = await client.get(f"/api/books/{book.id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "dnf"

    clear_resp = await client.delete(f"/api/books/{book.id}/dnf")
    assert clear_resp.status_code == 204

    detail_after_clear = await client.get(f"/api/books/{book.id}")
    assert detail_after_clear.status_code == 200
    assert detail_after_clear.json()["status"] == "unread"
