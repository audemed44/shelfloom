"""Reading goals and the year in review."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

from app.models.book import Book
from app.models.genre import BookGenre, Genre
from app.models.reading import ReadingProgress, ReadingSession
from app.models.shelf import Shelf
from app.services.year_review import goal_progress


async def _library(db_session, tmp_path):
    shelf = Shelf(name="Library", path=str(tmp_path))
    fantasy = Genre(name="Fantasy")
    db_session.add_all([shelf, fantasy])
    await db_session.flush()

    async def finished(title, author, pages, rating, sessions, *, genre=False):
        book = Book(
            id=str(uuid.uuid4()),
            title=title,
            author=author,
            format="epub",
            file_path=f"{title}.epub",
            shelf_id=shelf.id,
            page_count=pages,
            rating=rating,
        )
        db_session.add(book)
        await db_session.flush()
        db_session.add(ReadingProgress(book_id=book.id, progress=100.0, device="Kindle"))
        for start, minutes in sessions:
            db_session.add(
                ReadingSession(
                    book_id=book.id,
                    start_time=start,
                    duration=minutes * 60,
                    pages_read=minutes,
                    source="manual",
                )
            )
        if genre:
            db_session.add(BookGenre(book_id=book.id, genre_id=fantasy.id))
        return book

    # Started in December 2025, finished 3 January 2026: 34 days.
    await finished(
        "Long One",
        "Author A",
        900,
        4.0,
        [(datetime(2025, 12, 1, 21), 60), (datetime(2026, 1, 3, 22), 90)],
        genre=True,
    )
    await finished(
        "Quick One",
        "Author A",
        150,
        5.0,
        [(datetime(2026, 3, 10, 8), 120), (datetime(2026, 3, 11, 8), 30)],
        genre=True,
    )
    await finished("Other", "Author B", 300, None, [(datetime(2026, 3, 12, 9), 45)])
    # Finished last year: not part of 2026.
    await finished("Old", "Author C", 200, 3.0, [(datetime(2025, 6, 1, 14), 30)])
    await db_session.commit()


@pytest.mark.asyncio
async def test_year_in_review(client, db_session, tmp_path):
    await _library(db_session, tmp_path)
    resp = await client.get("/api/stats/year/2026")
    assert resp.status_code == 200
    r = resp.json()
    assert [b["title"] for b in r["books"]] == ["Long One", "Quick One", "Other"]
    assert r["totals"] == {
        "books": 3,
        "pages": 90 + 120 + 30 + 45,
        "seconds": (90 + 120 + 30 + 45) * 60,
        "sessions": 4,
        "reading_days": 4,
        "longest_streak": 3,  # 10–12 March
    }
    assert r["months"][0]["books"] == 1 and r["months"][2]["books"] == 2
    assert r["months"][2]["seconds"] == (120 + 30 + 45) * 60
    h = r["highlights"]
    assert h["longest_book"]["title"] == "Long One"
    assert h["shortest_book"]["title"] == "Quick One"
    assert h["top_rated"]["title"] == "Quick One"
    assert h["fastest_read"]["title"] == "Other"  # 1 day
    assert r["books"][0]["days_to_read"] == 34  # counts the 2025 session
    assert h["busiest_day"] == {"date": "2026-03-10", "seconds": 7200}
    assert h["favourite_time"] == "morning"
    assert r["top_authors"][0] == {"name": "Author A", "books": 2}
    assert r["top_genres"] == [{"name": "Fantasy", "books": 2}]
    assert r["average_rating"] == 4.5

    years = (await client.get("/api/stats/years")).json()
    assert 2026 in years and 2025 in years
    assert years == sorted(years, reverse=True)


@pytest.mark.asyncio
async def test_goal_crud(client, db_session, tmp_path):
    await _library(db_session, tmp_path)
    assert (await client.get("/api/stats/goal/2026")).json()["target"] is None

    resp = await client.put("/api/stats/goal/2026", json={"books": 12})
    assert resp.status_code == 200
    assert resp.json()["target"] == 12
    assert resp.json()["completed"] == 3
    assert (await client.put("/api/stats/goal/2026", json={"books": 0})).status_code == 422

    assert (await client.get("/api/stats/year/2026")).json()["goal"]["target"] == 12
    assert (await client.delete("/api/stats/goal/2026")).status_code == 204
    assert (await client.delete("/api/stats/goal/2026")).status_code == 404


@pytest.mark.asyncio
async def test_goal_pace(client, db_session, tmp_path):
    await _library(db_session, tmp_path)  # 3 books finished by March 2026
    await client.put("/api/stats/goal/2026", json={"books": 12})
    await client.put("/api/stats/goal/2025", json={"books": 5})

    # 1 April: a quarter through the year, 3 expected, 3 done.
    on_pace = await goal_progress(db_session, 2026, today=date(2026, 4, 1))
    assert on_pace["status"] == "on_track"
    assert on_pace["remaining"] == 9
    assert on_pace["per_month_needed"] == 1.0  # 9 books over Apr–Dec
    behind = await goal_progress(db_session, 2026, today=date(2026, 10, 1))
    assert behind["status"] == "behind"
    ahead = await goal_progress(db_session, 2026, today=date(2026, 1, 20))
    assert ahead["status"] == "ahead"
    # 2025: one book finished of 5, and the year is over.
    past = await goal_progress(db_session, 2025, today=date(2026, 4, 1))
    assert (past["completed"], past["status"]) == (1, "missed")

    await client.put("/api/stats/goal/2026", json={"books": 3})
    done = await goal_progress(db_session, 2026, today=date(2026, 4, 1))
    assert done["status"] == "done"
