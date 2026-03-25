"""Tests for manual book creation and session logging."""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _ensure_shelf(db_session):
    """Create a shelf so the DB is non-empty (manual shelf is separate)."""
    from app.models.shelf import Shelf

    shelf = Shelf(name="Regular", path="/shelves/regular")
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


# ---------------------------------------------------------------------------
# ensure_manual_shelf
# ---------------------------------------------------------------------------


async def test_ensure_manual_shelf_creates_on_first_call(db_session):
    from app.services.shelf_service import MANUAL_SHELF_PATH, ensure_manual_shelf

    shelf = await ensure_manual_shelf(db_session)
    assert shelf.id is not None
    assert shelf.path == MANUAL_SHELF_PATH
    assert shelf.name == "Manual"
    assert shelf.is_default is False
    assert shelf.is_sync_target is False


async def test_ensure_manual_shelf_idempotent(db_session):
    from app.services.shelf_service import ensure_manual_shelf

    shelf1 = await ensure_manual_shelf(db_session)
    shelf2 = await ensure_manual_shelf(db_session)
    assert shelf1.id == shelf2.id


# ---------------------------------------------------------------------------
# POST /api/books/manual
# ---------------------------------------------------------------------------


async def test_create_manual_book_minimal(client, db_session):
    resp = await client.post("/api/books/manual", json={"title": "Dune"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Dune"
    assert data["format"] == "physical"
    assert data["file_path"].startswith("manual://")


async def test_create_manual_book_visual_novel(client, db_session):
    resp = await client.post(
        "/api/books/manual",
        json={"title": "Steins;Gate", "author": "5pb.", "format": "visual_novel"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["format"] == "visual_novel"
    assert data["author"] == "5pb."


async def test_create_manual_book_full_fields(client, db_session):
    payload = {
        "title": "The Name of the Wind",
        "author": "Patrick Rothfuss",
        "isbn": "9780756404079",
        "format": "physical",
        "publisher": "DAW Books",
        "language": "en",
        "description": "A great book.",
        "page_count": 662,
        "date_published": "2007-03-27",
    }
    resp = await client.post("/api/books/manual", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["page_count"] == 662
    assert data["genres"] == []


async def test_create_manual_book_auto_creates_shelf(client, db_session):
    from sqlalchemy import select

    from app.models.shelf import Shelf
    from app.services.shelf_service import MANUAL_SHELF_PATH

    # No manual shelf yet
    result = await db_session.execute(select(Shelf).where(Shelf.path == MANUAL_SHELF_PATH))
    assert result.scalar_one_or_none() is None

    resp = await client.post("/api/books/manual", json={"title": "Test"})
    assert resp.status_code == 201

    result = await db_session.execute(select(Shelf).where(Shelf.path == MANUAL_SHELF_PATH))
    assert result.scalar_one_or_none() is not None


async def test_create_manual_book_missing_title(client, db_session):
    resp = await client.post("/api/books/manual", json={})
    assert resp.status_code == 422


async def test_manual_book_appears_in_library(client, db_session):
    await client.post("/api/books/manual", json={"title": "Physical Book"})
    resp = await client.get("/api/books")
    assert resp.status_code == 200
    titles = [b["title"] for b in resp.json()["items"]]
    assert "Physical Book" in titles


# ---------------------------------------------------------------------------
# File-operation guards for manual books
# ---------------------------------------------------------------------------


async def _make_manual_book(client):
    resp = await client.post("/api/books/manual", json={"title": "Guard Test"})
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_download_manual_book_returns_400(client, db_session):
    book_id = await _make_manual_book(client)
    resp = await client.get(f"/api/books/{book_id}/download")
    assert resp.status_code == 400


async def test_refresh_cover_manual_book_returns_400(client, db_session):
    book_id = await _make_manual_book(client)
    resp = await client.post(f"/api/books/{book_id}/refresh-cover")
    assert resp.status_code == 400


async def test_move_manual_book_returns_400(client, db_session):
    await _ensure_shelf(db_session)
    book_id = await _make_manual_book(client)
    resp = await client.post(f"/api/books/{book_id}/move", json={"shelf_id": 1})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/books/{book_id}/sessions  (manual session logging)
# ---------------------------------------------------------------------------


async def _make_book(db_session):
    import uuid

    from app.models.book import Book
    from app.models.shelf import Shelf

    shelf = Shelf(name="S", path="/s")
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(uuid.uuid4()),
        title="Digital Book",
        format="epub",
        file_path="book.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


async def test_log_manual_session(client, db_session):
    book = await _make_book(db_session)
    payload = {
        "start_time": "2026-03-15T10:00:00",
        "duration": 3600,
        "pages_read": 50,
    }
    resp = await client.post(f"/api/books/{book.id}/sessions", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["source"] == "manual"
    assert data["duration"] == 3600
    assert data["pages_read"] == 50
    assert data["dismissed"] is False


async def test_log_manual_session_appears_in_list(client, db_session):
    book = await _make_book(db_session)
    await client.post(
        f"/api/books/{book.id}/sessions",
        json={"start_time": "2026-03-15T10:00:00", "duration": 1800},
    )
    resp = await client.get(f"/api/books/{book.id}/sessions")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_log_manual_session_minimal(client, db_session):
    book = await _make_book(db_session)
    resp = await client.post(
        f"/api/books/{book.id}/sessions",
        json={"start_time": "2026-03-15T10:00:00"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["duration"] is None
    assert data["pages_read"] is None


async def test_log_manual_session_not_found(client, db_session):
    resp = await client.post(
        "/api/books/nonexistent-id/sessions",
        json={"start_time": "2026-03-15T10:00:00"},
    )
    assert resp.status_code == 404


async def test_log_session_for_manual_book(client, db_session):
    """Manual sessions work for manual (physical) books too."""
    book_resp = await client.post("/api/books/manual", json={"title": "Physical Dune"})
    book_id = book_resp.json()["id"]

    resp = await client.post(
        f"/api/books/{book_id}/sessions",
        json={"start_time": "2026-03-16T20:00:00", "duration": 7200, "pages_read": 80},
    )
    assert resp.status_code == 201
    assert resp.json()["source"] == "manual"
