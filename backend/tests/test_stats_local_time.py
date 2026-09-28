"""Stats group reading by the server's local time zone, not UTC."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import ReadingSession
from app.models.shelf import Shelf
from app.services.local_time import to_local, to_utc


@pytest.fixture
def kolkata():
    """Run with TZ=Asia/Kolkata (UTC+5:30), like the example docker-compose."""
    old = os.environ.get("TZ")
    os.environ["TZ"] = "Asia/Kolkata"
    time.tzset()
    yield
    if old is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = old
    time.tzset()


@pytest_asyncio.fixture
async def shelf(db_session: AsyncSession) -> Shelf:
    s = Shelf(name="Library", path="/tmp/tz-books")
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _book(db: AsyncSession, shelf: Shelf, author: str = "Author") -> Book:
    b = Book(
        id=str(uuid.uuid4()),
        title="A Book",
        author=author,
        format="epub",
        file_path=f"{uuid.uuid4()}.epub",
        shelf_id=shelf.id,
    )
    db.add(b)
    await db.commit()
    return b


async def _session(
    db: AsyncSession, book: Book, start: datetime, duration: int = 1800, pages: int | None = 20
) -> None:
    db.add(
        ReadingSession(
            book_id=book.id,
            start_time=start,
            duration=duration,
            pages_read=pages,
            source="manual",
        )
    )
    await db.commit()


def test_conversions(kolkata) -> None:
    assert to_local(datetime(2024, 1, 1, 20, 0)) == datetime(2024, 1, 2, 1, 30)
    assert to_utc(datetime(2024, 1, 2, 1, 30)) == datetime(2024, 1, 1, 20, 0)


@pytest.mark.asyncio
async def test_late_night_reading_counts_on_the_local_day(
    kolkata, client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _book(db_session, shelf)
    # 20:00 UTC on Jan 1 is 01:30 on Jan 2 in Kolkata.
    await _session(db_session, book, datetime(2024, 1, 1, 20, 0))

    series = (
        await client.get(
            "/api/stats/reading-time?granularity=day"
            "&from=2024-01-01T00:00:00%2B05:30&to=2024-01-03T23:59:59%2B05:30"
        )
    ).json()
    assert [r for r in series if r["value"]] == [{"date": "2024-01-02", "value": 1800}]

    dist = (await client.get("/api/stats/distribution")).json()
    assert [h["hour"] for h in dist["by_hour"] if h["seconds"]] == [1]
    # Jan 2 2024 was a Tuesday (SQLite %w = 2).
    assert [d["weekday"] for d in dist["by_weekday"] if d["seconds"]] == [2]

    cal = (await client.get("/api/stats/calendar?year=2024&month=1")).json()
    assert [d["date"] for d in cal if d["books"]] == ["2024-01-02"]

    heat = (await client.get("/api/stats/heatmap?year=2024")).json()
    assert [d["date"] for d in heat if d["seconds"]] == ["2024-01-02"]


@pytest.mark.asyncio
async def test_new_years_eve_reading_belongs_to_the_local_year(
    kolkata, client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _book(db_session, shelf)
    # 19:00 UTC on Dec 31 2023 is already Jan 1 2024 in Kolkata.
    await _session(db_session, book, datetime(2023, 12, 31, 19, 0))
    heat23 = (await client.get("/api/stats/heatmap?year=2023")).json()
    heat24 = (await client.get("/api/stats/heatmap?year=2024")).json()
    assert not any(d["seconds"] for d in heat23)
    assert heat24[0] == {"date": "2024-01-01", "seconds": 1800}


@pytest.mark.asyncio
async def test_overview_speed_ignores_sessions_without_pages(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    book = await _book(db_session, shelf)
    await _session(db_session, book, datetime(2024, 3, 1, 10, tzinfo=UTC), 3600, 60)
    await _session(db_session, book, datetime(2024, 3, 2, 10, tzinfo=UTC), 3600, None)
    await _session(db_session, book, datetime(2024, 3, 2, 12, tzinfo=UTC), 0, 0)

    data = (await client.get("/api/stats/overview")).json()
    assert data["pages_per_hour"] == 60.0
    assert data["total_reading_time_seconds"] == 7200
    assert data["reading_days"] == 2
    assert data["sessions"] == 3
    assert data["first_session_date"] == "2024-03-01"


@pytest.mark.asyncio
async def test_authors_and_distribution_follow_the_range(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf
) -> None:
    old = await _book(db_session, shelf, "Old Author")
    new = await _book(db_session, shelf, "New Author")
    await _session(db_session, old, datetime(2024, 1, 5, 9, tzinfo=UTC))
    await _session(db_session, new, datetime(2024, 6, 5, 9, tzinfo=UTC))

    q = "from=2024-06-01T00:00:00Z"
    authors = (await client.get(f"/api/stats/by-author?{q}")).json()
    assert [a["author"] for a in authors] == ["New Author"]
    dist = (await client.get(f"/api/stats/distribution?{q}")).json()
    assert sum(h["seconds"] for h in dist["by_hour"]) == 1800
    all_authors = (await client.get("/api/stats/by-author")).json()
    assert {a["author"] for a in all_authors} == {"Old Author", "New Author"}
