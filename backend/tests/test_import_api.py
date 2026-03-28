"""Tests for scan trigger, status, and incremental scan (Step 1.10)."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.shelf import Shelf
from app.services.import_service import import_shelf
from app.services.scheduler import Scheduler

# ── Scheduler unit tests ──────────────────────────────────────────────────────


async def test_scheduler_initial_status():
    s = Scheduler()
    assert s.status.is_running is False
    assert s.status.last_scan_at is None
    assert s.status.progress is None
    assert s.status.error is None


def _make_factory(session=None, side_effect=None):
    """Build a sync-callable factory that returns an async context manager."""
    ctx = AsyncMock()
    if side_effect:
        ctx.__aenter__ = AsyncMock(side_effect=side_effect)
    else:
        ctx.__aenter__ = AsyncMock(return_value=session)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


async def test_scheduler_run_scan_updates_status():
    s = Scheduler()
    settings = MagicMock(covers_dir="/tmp/covers")

    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    factory = _make_factory(session=session)

    await s._run_scan(factory, settings, "/tmp/covers")

    assert s.status.is_running is False
    assert s.status.last_scan_at is not None
    assert s.status.error is None


async def test_scheduler_run_scan_sets_error_on_exception():
    s = Scheduler()
    settings = MagicMock(covers_dir="/tmp")
    factory = _make_factory(side_effect=RuntimeError("DB gone"))

    await s._run_scan(factory, settings, "/tmp")

    assert s.status.is_running is False
    assert s.status.error is not None
    assert "DB gone" in s.status.error


async def test_scheduler_trigger_returns_none_if_running():
    s = Scheduler()
    s.status.is_running = True
    result = await s.trigger(None, None, "/tmp")
    assert result is None


async def test_scheduler_trigger_creates_task():
    s = Scheduler()
    settings = MagicMock(covers_dir="/tmp")
    ran = []

    async def fake_run(factory, settings, covers_dir):
        ran.append(True)

    with patch.object(s, "_run_scan", fake_run):
        task = await s.trigger(None, settings, "/tmp")
        assert task is not None
        await task  # ensure it runs

    assert ran == [True]


async def test_scheduler_loop_runs_scan_then_sleeps():
    s = Scheduler()
    settings = MagicMock(scan_interval=300)
    calls: list[str] = []

    async def fake_run(factory, settings, covers_dir):
        calls.append("scan")

    async def fake_sleep(n):
        calls.append(f"sleep:{n}")
        raise asyncio.CancelledError()

    with patch.object(s, "_run_scan", fake_run):
        with patch("app.services.scheduler.asyncio.sleep", fake_sleep):
            try:
                await s._loop(None, settings, "/tmp")
            except asyncio.CancelledError:
                pass

    assert calls == ["scan", "sleep:300"]


async def test_scheduler_stop_cancels_loop():
    s = Scheduler()
    settings = MagicMock(scan_interval=9999, serial_check_interval=9999)

    # Start a loop that would sleep forever
    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    factory = _make_factory(session=session)

    await s.start(factory, settings, "/tmp")
    # Give the loop task a moment to start

    await asyncio.sleep(0)
    await s.stop()
    assert s._loop_task is None


# ── Incremental scan tests ────────────────────────────────────────────────────


async def test_incremental_unchanged_skipped(db_session, tmp_path):
    """Files whose mtime is cached and unchanged should be skipped."""
    shelf = Shelf(name="IncShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    # Create a real EPUB file
    from ebooklib import epub

    book_path = tmp_path / "book.epub"
    eb = epub.EpubBook()
    eb.set_identifier("id-inc")
    eb.set_title("Inc Book")
    eb.add_author("Author")
    c = epub.EpubHtml(title="C", file_name="c.xhtml")
    c.content = "<p>hi</p>"
    eb.add_item(c)
    eb.spine = ["nav", c]
    eb.add_item(epub.EpubNcx())
    eb.add_item(epub.EpubNav())
    epub.write_epub(str(book_path), eb)

    covers = tmp_path / "covers"
    covers.mkdir()

    # First scan: file created
    p1 = await import_shelf(db_session, shelf, str(covers))
    assert p1.created == 1

    # Second scan with mtime_cache: nothing changed → skipped
    cache: dict[str, float] = {}
    cache[str(book_path)] = book_path.stat().st_mtime  # pre-fill

    p2 = await import_shelf(db_session, shelf, str(covers), mtime_cache=cache)
    assert p2.skipped == 1
    assert p2.created == 0


async def test_incremental_new_file_picked_up(db_session, tmp_path):
    """A new file not in the mtime cache should be imported."""
    shelf = Shelf(name="NewFileShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    covers = tmp_path / "covers"
    covers.mkdir()

    from ebooklib import epub

    def _make_epub(path: Path, title: str) -> None:
        eb = epub.EpubBook()
        eb.set_identifier(f"id-{uuid.uuid4()}")
        eb.set_title(title)
        eb.add_author("A")
        c = epub.EpubHtml(title="C", file_name="c.xhtml")
        c.content = "<p>x</p>"
        eb.add_item(c)
        eb.spine = ["nav", c]
        eb.add_item(epub.EpubNcx())
        eb.add_item(epub.EpubNav())
        epub.write_epub(str(path), eb)

    # First scan: creates book1
    _make_epub(tmp_path / "book1.epub", "Book 1")
    cache: dict[str, float] = {}
    p1 = await import_shelf(db_session, shelf, str(covers), mtime_cache=cache)
    assert p1.created == 1

    # Add a new file, scan again
    _make_epub(tmp_path / "book2.epub", "Book 2")
    p2 = await import_shelf(db_session, shelf, str(covers), mtime_cache=cache)
    assert p2.created == 1  # book2 imported
    assert p2.skipped == 1  # book1 skipped (mtime cached)


async def test_incremental_changed_file_detected(db_session, tmp_path):
    """A file whose mtime changed should be re-processed."""
    shelf = Shelf(name="ChangedShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    covers = tmp_path / "covers"
    covers.mkdir()

    from ebooklib import epub

    book_path = tmp_path / "changing.epub"
    eb = epub.EpubBook()
    eb.set_identifier(f"id-{uuid.uuid4()}")
    eb.set_title("Changing")
    eb.add_author("A")
    c = epub.EpubHtml(title="C", file_name="c.xhtml")
    c.content = "<p>v1</p>"
    eb.add_item(c)
    eb.spine = ["nav", c]
    eb.add_item(epub.EpubNcx())
    eb.add_item(epub.EpubNav())
    epub.write_epub(str(book_path), eb)

    cache: dict[str, float] = {}
    p1 = await import_shelf(db_session, shelf, str(covers), mtime_cache=cache)
    assert p1.created == 1

    # Simulate a changed file by clearing its mtime from cache
    cache.pop(str(book_path), None)

    p2 = await import_shelf(db_session, shelf, str(covers), mtime_cache=cache)
    # File re-processed (skipped because hash unchanged, but not the mtime-skip path)
    assert p2.skipped == 1  # hash unchanged → skipped by import logic
    assert p2.created == 0


# ── API endpoint tests ────────────────────────────────────────────────────────


async def test_scan_status_initial(client):
    resp = await client.get("/api/import/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_running"] is False
    assert data["last_scan_at"] is None
    assert data["progress"] is None
    assert data["error"] is None


async def test_trigger_scan_returns_202(client):
    resp = await client.post("/api/import/scan")
    assert resp.status_code == 202
    assert "triggered" in resp.json()["message"].lower()


async def test_trigger_scan_no_op_while_running(client):
    """Trigger while is_running=True should return 202 but not start another scan."""
    scheduler = client.app.state.scheduler
    scheduler.status.is_running = True

    resp = await client.post("/api/import/scan")
    assert resp.status_code == 202
    # Clean up
    scheduler.status.is_running = False


async def test_scan_status_after_scan(client, tmp_path):
    """After a completed scan, status shows last_scan_at and progress."""
    scheduler = client.app.state.scheduler
    settings = MagicMock(covers_dir=str(tmp_path))

    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    factory = _make_factory(session=session)

    await scheduler._run_scan(factory, settings, str(tmp_path))

    resp = await client.get("/api/import/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_running"] is False
    assert data["last_scan_at"] is not None
    assert data["progress"] is not None


# ── backfill-covers ───────────────────────────────────────────────────────────


async def test_backfill_covers_no_books(client):
    """With no books in DB, backfill returns all zeros."""
    resp = await client.post("/api/import/backfill-covers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["refreshed"] == 0
    assert data["failed"] == 0
    assert data["skipped"] == 0


async def test_backfill_covers_skips_books_with_existing_cover(client, db_session, tmp_path):
    """Books whose cover file already exists on disk are skipped."""
    import uuid as _uuid

    from app.models.book import Book
    from app.models.shelf import Shelf

    shelf = Shelf(name="BFShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    covers = tmp_path / "covers"
    covers.mkdir()
    cover_file = covers / "existing.jpg"
    cover_file.write_bytes(b"fakejpeg")

    book = Book(
        id=str(_uuid.uuid4()),
        title="HasCover",
        author="A",
        format="epub",
        file_path="x.epub",
        shelf_id=shelf.id,
        cover_path=str(cover_file),
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post("/api/import/backfill-covers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["skipped"] == 1
    assert data["refreshed"] == 0


async def test_backfill_covers_fails_book_with_missing_file(client, db_session, tmp_path):
    """Books whose file doesn't exist on disk count as failed, not errored."""
    import uuid as _uuid

    from app.models.book import Book
    from app.models.shelf import Shelf

    shelf = Shelf(name="BFShelf2", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(_uuid.uuid4()),
        title="MissingFile",
        author="A",
        format="epub",
        file_path="ghost.epub",
        shelf_id=shelf.id,
        cover_path=None,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post("/api/import/backfill-covers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["failed"] == 1
    assert data["refreshed"] == 0
