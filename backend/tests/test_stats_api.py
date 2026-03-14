"""Tests for Step 4.1 — Stats API."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import ReadingProgress, ReadingSession
from app.models.shelf import Shelf
from app.models.tag import BookTag, Tag


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def shelf(db_session: AsyncSession) -> Shelf:
    s = Shelf(name="Test", path="/shelves/test")
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _make_book(
    db_session: AsyncSession,
    shelf_id: int,
    title: str = "A Book",
    author: str | None = "Author A",
) -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        shelf_id=shelf_id,
        format="epub",
        file_path=f"{title}.epub",
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


async def _make_session(
    db_session: AsyncSession,
    book_id: str,
    start_time: datetime,
    duration: int = 3600,
    pages_read: int = 30,
    dismissed: bool = False,
) -> ReadingSession:
    rs = ReadingSession(
        book_id=book_id,
        start_time=start_time,
        duration=duration,
        pages_read=pages_read,
        source="manual",
        dismissed=dismissed,
    )
    db_session.add(rs)
    await db_session.commit()
    await db_session.refresh(rs)
    return rs


async def _make_progress(
    db_session: AsyncSession,
    book_id: str,
    progress: float,
) -> ReadingProgress:
    rp = ReadingProgress(book_id=book_id, progress=progress)
    db_session.add(rp)
    await db_session.commit()
    await db_session.refresh(rp)
    return rp


# ---------------------------------------------------------------------------
# /api/stats/overview
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["books_owned"] == 0
    assert data["books_read"] == 0
    assert data["total_reading_time_seconds"] == 0
    assert data["total_pages_read"] == 0
    assert data["current_streak_days"] == 0


@pytest.mark.asyncio
async def test_overview_with_data(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book1 = await _make_book(db_session, shelf.id, "Book 1")
    book2 = await _make_book(db_session, shelf.id, "Book 2")

    now = datetime.now(timezone.utc)
    await _make_session(db_session, book1.id, now - timedelta(hours=2), duration=1800, pages_read=20)
    await _make_session(db_session, book2.id, now - timedelta(hours=1), duration=3600, pages_read=40)
    # dismissed session should not count
    await _make_session(db_session, book1.id, now - timedelta(hours=3), duration=9999, dismissed=True)

    await _make_progress(db_session, book1.id, 1.0)  # book1 complete
    await _make_progress(db_session, book2.id, 0.5)  # book2 in progress

    resp = await client.get("/api/stats/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["books_owned"] == 2
    assert data["books_read"] == 1
    assert data["total_reading_time_seconds"] == 5400  # 1800 + 3600
    assert data["total_pages_read"] == 60  # 20 + 40
    assert data["current_streak_days"] >= 1


@pytest.mark.asyncio
async def test_overview_dismissed_excluded(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    now = datetime.now(timezone.utc)
    await _make_session(db_session, book.id, now, duration=500, dismissed=True)

    resp = await client.get("/api/stats/overview")
    data = resp.json()
    assert data["total_reading_time_seconds"] == 0
    assert data["total_pages_read"] == 0


# ---------------------------------------------------------------------------
# /api/stats/reading-time
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reading_time_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/reading-time")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_reading_time_day_granularity(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    d1 = datetime(2024, 6, 1, 10, 0, tzinfo=timezone.utc)
    d2 = datetime(2024, 6, 2, 10, 0, tzinfo=timezone.utc)
    await _make_session(db_session, book.id, d1, duration=600, pages_read=5)
    await _make_session(db_session, book.id, d1, duration=400, pages_read=3)
    await _make_session(db_session, book.id, d2, duration=1200, pages_read=10)

    resp = await client.get("/api/stats/reading-time?granularity=day")
    assert resp.status_code == 200
    rows = {r["date"]: r["value"] for r in resp.json()}
    assert rows["2024-06-01"] == 1000
    assert rows["2024-06-02"] == 1200


@pytest.mark.asyncio
async def test_reading_time_month_granularity(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, datetime(2024, 1, 5, tzinfo=timezone.utc), duration=100)
    await _make_session(db_session, book.id, datetime(2024, 2, 10, tzinfo=timezone.utc), duration=200)

    resp = await client.get("/api/stats/reading-time?granularity=month")
    rows = {r["date"]: r["value"] for r in resp.json()}
    assert rows["2024-01"] == 100
    assert rows["2024-02"] == 200


@pytest.mark.asyncio
async def test_reading_time_week_granularity(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, datetime(2024, 1, 8, tzinfo=timezone.utc), duration=300)

    resp = await client.get("/api/stats/reading-time?granularity=week")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["value"] == 300


@pytest.mark.asyncio
async def test_reading_time_date_filter(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, datetime(2024, 1, 1, tzinfo=timezone.utc), duration=100)
    await _make_session(db_session, book.id, datetime(2024, 6, 1, tzinfo=timezone.utc), duration=200)

    resp = await client.get("/api/stats/reading-time?from=2024-03-01T00:00:00")
    data = resp.json()
    assert all(r["date"] >= "2024-03" for r in data)
    assert len(data) == 1
    assert data[0]["value"] == 200


# ---------------------------------------------------------------------------
# /api/stats/pages
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pages_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/pages")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_pages_aggregation(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    d = datetime(2024, 3, 15, tzinfo=timezone.utc)
    await _make_session(db_session, book.id, d, pages_read=15)
    await _make_session(db_session, book.id, d, pages_read=10)

    resp = await client.get("/api/stats/pages?granularity=day")
    rows = {r["date"]: r["value"] for r in resp.json()}
    assert rows["2024-03-15"] == 25


# ---------------------------------------------------------------------------
# /api/stats/books-completed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_books_completed_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/books-completed")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_books_completed_with_data(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    b1 = await _make_book(db_session, shelf.id, "Finished Book")
    b2 = await _make_book(db_session, shelf.id, "Unfinished Book")
    await _make_progress(db_session, b1.id, 1.0)
    await _make_progress(db_session, b2.id, 0.4)

    resp = await client.get("/api/stats/books-completed")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["book_id"] == b1.id
    assert data[0]["title"] == "Finished Book"
    assert "completed_at" in data[0]


# ---------------------------------------------------------------------------
# /api/stats/streaks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_streaks_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/streaks")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current"] == 0
    assert data["longest"] == 0
    assert data["last_read_date"] is None
    assert data["history"] == []


@pytest.mark.asyncio
async def test_streaks_consecutive(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    # 3 consecutive days
    for delta in range(3):
        await _make_session(
            db_session,
            book.id,
            datetime(2024, 6, 1, tzinfo=timezone.utc) + timedelta(days=delta),
            duration=600,
        )

    resp = await client.get("/api/stats/streaks")
    data = resp.json()
    assert data["longest"] == 3
    # current is 0 since 2024-06-03 is not today/yesterday in test context
    assert data["current"] == 0
    assert len(data["history"]) == 1
    assert data["history"][0]["days"] == 3


@pytest.mark.asyncio
async def test_streaks_with_gap(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    # Run of 2, gap, run of 1
    for d in [datetime(2024, 1, 1), datetime(2024, 1, 2), datetime(2024, 1, 10)]:
        await _make_session(db_session, book.id, d.replace(tzinfo=timezone.utc), duration=600)

    resp = await client.get("/api/stats/streaks")
    data = resp.json()
    assert data["longest"] == 2
    assert len(data["history"]) == 2


# ---------------------------------------------------------------------------
# /api/stats/heatmap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_heatmap_full_year(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/heatmap?year=2023")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 365  # 2023 is not a leap year
    assert all("date" in d and "seconds" in d for d in data)
    assert all(d["date"].startswith("2023") for d in data)
    assert all(d["seconds"] == 0 for d in data)  # no data


@pytest.mark.asyncio
async def test_heatmap_leap_year(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/heatmap?year=2024")
    data = resp.json()
    assert len(data) == 366  # 2024 is a leap year


@pytest.mark.asyncio
async def test_heatmap_with_data(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, datetime(2024, 3, 15, tzinfo=timezone.utc), duration=1800)
    await _make_session(db_session, book.id, datetime(2024, 3, 15, tzinfo=timezone.utc), duration=600)

    resp = await client.get("/api/stats/heatmap?year=2024")
    data = resp.json()
    day = next(d for d in data if d["date"] == "2024-03-15")
    assert day["seconds"] == 2400
    # other days zero
    assert sum(d["seconds"] for d in data if d["date"] != "2024-03-15") == 0


@pytest.mark.asyncio
async def test_heatmap_dismissed_excluded(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(
        db_session, book.id, datetime(2024, 5, 1, tzinfo=timezone.utc), duration=9999, dismissed=True
    )
    resp = await client.get("/api/stats/heatmap?year=2024")
    data = resp.json()
    assert all(d["seconds"] == 0 for d in data)


# ---------------------------------------------------------------------------
# /api/stats/distribution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_distribution_structure(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/distribution")
    assert resp.status_code == 200
    data = resp.json()
    assert "by_hour" in data and "by_weekday" in data
    assert len(data["by_hour"]) == 24
    assert len(data["by_weekday"]) == 7
    assert all(h["seconds"] == 0 for h in data["by_hour"])
    assert all(w["seconds"] == 0 for w in data["by_weekday"])


@pytest.mark.asyncio
async def test_distribution_hours(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    # Session at 14:00 UTC on a Wednesday (2024-06-05 is Wednesday → weekday=3 in SQLite)
    await _make_session(db_session, book.id, datetime(2024, 6, 5, 14, 0, tzinfo=timezone.utc), duration=500)

    resp = await client.get("/api/stats/distribution")
    data = resp.json()
    hour_14 = next(h for h in data["by_hour"] if h["hour"] == 14)
    assert hour_14["seconds"] == 500


# ---------------------------------------------------------------------------
# /api/stats/by-author
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_author_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/by-author")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_by_author_aggregation(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    b1 = await _make_book(db_session, shelf.id, "Book A", author="Alice")
    b2 = await _make_book(db_session, shelf.id, "Book B", author="Bob")
    b3 = await _make_book(db_session, shelf.id, "Book C", author="Alice")

    now = datetime.now(timezone.utc)
    await _make_session(db_session, b1.id, now, duration=600)
    await _make_session(db_session, b3.id, now, duration=400)
    await _make_session(db_session, b2.id, now, duration=300)
    # dismissed session for Alice — must NOT count
    await _make_session(db_session, b1.id, now, duration=9999, dismissed=True)

    resp = await client.get("/api/stats/by-author")
    data = resp.json()
    authors = {r["author"]: r for r in data}
    assert authors["Alice"]["total_seconds"] == 1000
    assert authors["Alice"]["session_count"] == 2
    assert authors["Bob"]["total_seconds"] == 300
    # Alice first (most time)
    assert data[0]["author"] == "Alice"


@pytest.mark.asyncio
async def test_by_author_none_excluded(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id, "No Author", author=None)
    await _make_session(db_session, book.id, datetime.now(timezone.utc), duration=500)

    resp = await client.get("/api/stats/by-author")
    data = resp.json()
    assert all(r["author"] is not None for r in data)


# ---------------------------------------------------------------------------
# /api/stats/by-tag
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_tag_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/by-tag")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_by_tag_aggregation(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)

    tag = Tag(name="fantasy")
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)

    bt = BookTag(book_id=book.id, tag_id=tag.id)
    db_session.add(bt)
    await db_session.commit()

    now = datetime.now(timezone.utc)
    await _make_session(db_session, book.id, now, duration=800, pages_read=10)
    await _make_session(db_session, book.id, now, duration=200, pages_read=5)

    resp = await client.get("/api/stats/by-tag")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["tag"] == "fantasy"
    assert data[0]["total_seconds"] == 1000
    assert data[0]["session_count"] == 2


# ---------------------------------------------------------------------------
# /api/stats/by-book/{book_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_book_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/by-book/does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_by_book_no_sessions(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id, "Empty Book")

    resp = await client.get(f"/api/stats/by-book/{book.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["book_id"] == book.id
    assert data["total_seconds"] == 0
    assert data["total_pages"] == 0
    assert data["session_count"] == 0
    assert data["avg_pages_per_hour"] is None
    assert data["first_session"] is None
    assert data["last_session"] is None
    assert data["progress"] is None


@pytest.mark.asyncio
async def test_by_book_with_sessions(client: AsyncClient, db_session: AsyncSession, shelf: Shelf) -> None:
    book = await _make_book(db_session, shelf.id)
    t1 = datetime(2024, 1, 1, 10, tzinfo=timezone.utc)
    t2 = datetime(2024, 1, 2, 10, tzinfo=timezone.utc)
    await _make_session(db_session, book.id, t1, duration=3600, pages_read=60)
    await _make_session(db_session, book.id, t2, duration=1800, pages_read=30)
    # dismissed — excluded
    await _make_session(db_session, book.id, t1, duration=9999, dismissed=True)
    await _make_progress(db_session, book.id, 0.75)

    resp = await client.get(f"/api/stats/by-book/{book.id}")
    data = resp.json()
    assert data["total_seconds"] == 5400
    assert data["total_pages"] == 90
    assert data["session_count"] == 2
    assert data["avg_pages_per_hour"] == pytest.approx(60.0, rel=1e-2)
    assert data["progress"] == 0.75
    assert data["first_session"] is not None
    assert data["last_session"] is not None


# ---------------------------------------------------------------------------
# /api/stats/recent-sessions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recent_sessions_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats/recent-sessions")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_recent_sessions_returns_data(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _make_book(db_session, shelf.id, title="The Hobbit", author="Tolkien")
    now = datetime.now(timezone.utc)
    await _make_session(db_session, book.id, now - timedelta(hours=1), duration=3600)
    await _make_session(db_session, book.id, now - timedelta(hours=2), duration=1800)

    resp = await client.get("/api/stats/recent-sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["title"] == "The Hobbit"
    assert data[0]["author"] == "Tolkien"
    assert data[0]["duration"] == 3600
    assert data[0]["book_id"] == str(book.id)
    assert data[0]["start_time"] is not None


@pytest.mark.asyncio
async def test_recent_sessions_excludes_dismissed(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _make_book(db_session, shelf.id)
    await _make_session(db_session, book.id, datetime.now(timezone.utc), dismissed=True)

    resp = await client.get("/api/stats/recent-sessions")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_recent_sessions_limit(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _make_book(db_session, shelf.id)
    now = datetime.now(timezone.utc)
    for i in range(12):
        await _make_session(db_session, book.id, now - timedelta(hours=i))

    resp = await client.get("/api/stats/recent-sessions?limit=5")
    assert resp.status_code == 200
    assert len(resp.json()) == 5


@pytest.mark.asyncio
async def test_recent_sessions_sorted_newest_first(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    b1 = await _make_book(db_session, shelf.id, title="Old Book")
    b2 = await _make_book(db_session, shelf.id, title="New Book")
    now = datetime.now(timezone.utc)
    await _make_session(db_session, b1.id, now - timedelta(days=2))
    await _make_session(db_session, b2.id, now - timedelta(hours=1))

    resp = await client.get("/api/stats/recent-sessions")
    data = resp.json()
    assert data[0]["title"] == "New Book"
    assert data[1]["title"] == "Old Book"
