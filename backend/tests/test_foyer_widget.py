"""Tests for the Foyer dashboard widget endpoint."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import ReadingProgress, ReadingSession
from app.models.shelf import Shelf
from app.services.foyer_widget import _goal_caption, _hours


@pytest_asyncio.fixture
async def shelf(db_session: AsyncSession) -> Shelf:
    s = Shelf(name="Test", path="/shelves/test")
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _book(
    db_session: AsyncSession,
    shelf: Shelf,
    title: str,
    progress: float | None = None,
    read_at: datetime | None = None,
    cover_path: str | None = None,
) -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=f"{title} Author",
        shelf_id=shelf.id,
        format="epub",
        file_path=f"{title}.epub",
        cover_path=cover_path,
    )
    db_session.add(book)
    if progress is not None:
        db_session.add(ReadingProgress(book_id=book.id, progress=progress))
    if read_at is not None:
        db_session.add(
            ReadingSession(
                book_id=book.id,
                start_time=read_at.astimezone(UTC).replace(tzinfo=None),
                duration=1800,
                pages_read=20,
                source="manual",
            )
        )
    await db_session.commit()
    return book


@pytest.mark.asyncio
async def test_widget_empty_library(client: AsyncClient) -> None:
    resp = await client.get("/api/foyer/widget")
    assert resp.status_code == 200
    data = resp.json()
    year = datetime.now().year

    assert data["version"] == 1
    assert data["items"] == []
    assert data["progress"] == []
    assert data["items_layout"] == "covers"
    assert data["accepts"] == {
        "url": "/api/foyer/upload",
        "types": [".epub", ".pdf"],
        "label": "Add to library",
    }
    assert data["stats"] == [
        {"label": f"Read in {year}", "value": "0"},
        {"label": "Streak", "value": "0", "unit": "days", "caption": "best 0"},
        {"label": "This week", "value": "0.0", "unit": "h", "caption": "0 pages"},
        {"label": "Library", "value": "0", "unit": "/0", "caption": "books read"},
    ]


@pytest.mark.asyncio
async def test_widget_with_reading_and_goal(
    client: AsyncClient, db_session: AsyncSession, shelf: Shelf, tmp_path
) -> None:
    now = datetime.now(UTC)
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(b"jpeg")

    older = await _book(db_session, shelf, "Older", progress=10, read_at=now - timedelta(days=2))
    recent = await _book(
        db_session,
        shelf,
        "Recent",
        progress=42.4,
        read_at=now - timedelta(hours=1),
        cover_path=str(cover),
    )
    await _book(db_session, shelf, "Finished", progress=100)
    await _book(db_session, shelf, "Unread")
    # Read three weeks ago: counts for the library, not for this week.
    await _book(db_session, shelf, "Old", progress=5, read_at=now - timedelta(days=21))

    year = datetime.now().year
    assert (await client.put(f"/api/stats/goal/{year}", json={"books": 2})).status_code == 200

    data = (await client.get("/api/foyer/widget")).json()
    stats = {s["label"]: s for s in data["stats"]}

    assert stats[f"Read in {year}"]["value"] == "1"
    assert stats[f"Read in {year}"]["unit"] == "/2"
    assert stats["This week"] == {
        "label": "This week",
        "value": "1.0",
        "unit": "h",
        "caption": "40 pages",
    }
    assert stats["Library"]["value"] == "1"
    assert stats["Library"]["unit"] == "/5"

    [goal] = data["progress"]
    assert goal["label"] == f"{year} goal"
    assert (goal["value"], goal["max"]) == (1, 2)

    # Most recently read first; only books in progress.
    titles = [i["title"] for i in data["items"]]
    assert titles == ["Recent", "Older", "Old"]
    first = data["items"][0]
    assert first == {
        "title": "Recent",
        "subtitle": "Recent Author",
        "url": f"/books/{recent.id}",
        "image": f"/api/books/{recent.id}/cover",
        "progress": 42.4,
        "caption": "42%",
    }
    assert "image" not in data["items"][1]  # no cover on disk
    assert data["items"][1]["url"] == f"/books/{older.id}"

    # The image path is served by Shelfloom itself.
    assert (await client.get(first["image"])).status_code == 200


@pytest.mark.parametrize(
    ("goal", "caption"),
    [
        ({"status": "done", "completed": 5, "expected_by_now": 3}, "Goal reached"),
        ({"status": "on_track", "completed": 3, "expected_by_now": 3.2}, "On track"),
        ({"status": "missed", "completed": 1, "expected_by_now": 5}, "Goal missed"),
        ({"status": "ahead", "completed": 10, "expected_by_now": 6.6}, "3 books ahead of pace"),
        ({"status": "behind", "completed": 2, "expected_by_now": 3.4}, "1 book behind pace"),
        ({"status": None}, None),
    ],
)
def test_goal_caption(goal: dict, caption: str | None) -> None:
    assert _goal_caption(goal) == caption


def test_hours() -> None:
    assert _hours(0) == "0.0"
    assert _hours(5400) == "1.5"
    assert _hours(36000 * 1.26) == "13"


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_upload_from_foyer(client: AsyncClient, db_session: AsyncSession, tmp_path) -> None:
    db_session.add(Shelf(name="Main", path=str(tmp_path), is_default=True))
    await db_session.commit()

    resp = await client.post(
        "/api/foyer/upload",
        files={
            "file": ("test.epub", (FIXTURES / "test.epub").read_bytes(), "application/epub+zip")
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    book = (await db_session.execute(select(Book))).scalar_one()
    assert data["url"] == f"/books/{book.id}"
    assert data["message"].startswith(f"Added “{book.title}”")
    assert (tmp_path / "test.epub").exists()


@pytest.mark.asyncio
async def test_upload_from_foyer_rejects_other_files(
    client: AsyncClient, db_session: AsyncSession, tmp_path
) -> None:
    db_session.add(Shelf(name="Main", path=str(tmp_path), is_default=True))
    await db_session.commit()
    resp = await client.post(
        "/api/foyer/upload", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert resp.status_code == 400
    assert "epub" in resp.json()["detail"]
