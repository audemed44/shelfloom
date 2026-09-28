"""Reading goals and the year in review."""

from __future__ import annotations

import calendar
import math
from collections import Counter
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.genre import BookGenre, Genre
from app.models.goal import ReadingGoal
from app.models.reading import ReadingSession
from app.services.stats_service import get_books_completed


def _year_bounds(year: int) -> tuple[datetime, datetime]:
    return datetime(year, 1, 1), datetime(year, 12, 31, 23, 59, 59, 999999)


def _year_fraction(year: int, today: date) -> float:
    """How much of ``year`` has passed (0 before it starts, 1 once it's over)."""
    if year < today.year:
        return 1.0
    if year > today.year:
        return 0.0
    days = 366 if calendar.isleap(year) else 365
    return today.timetuple().tm_yday / days


# ── goals ─────────────────────────────────────────────────────────────────────


async def goal_progress(session: AsyncSession, year: int, today: date | None = None) -> dict:
    """The year's goal (if any), books finished, and whether that's on pace."""
    today = today or date.today()
    goal = await session.get(ReadingGoal, year)
    start, end = _year_bounds(year)
    completed = len(await get_books_completed(session, start, end))
    result: dict = {
        "year": year,
        "target": goal.books if goal else None,
        "completed": completed,
        "expected_by_now": None,
        "status": None,
        "remaining": None,
        "per_month_needed": None,
    }
    if goal is None:
        return result

    fraction = _year_fraction(year, today)
    expected = goal.books * fraction
    remaining = max(0, goal.books - completed)
    if completed >= goal.books:
        status = "done"
    elif fraction >= 1:
        status = "missed"
    elif completed - expected >= 1:
        status = "ahead"
    elif completed - expected <= -1:
        status = "behind"
    else:
        status = "on_track"
    months_left = 12 - today.month + 1 if year == today.year else (12 if year > today.year else 0)
    result.update(
        expected_by_now=round(expected, 1),
        status=status,
        remaining=remaining,
        per_month_needed=(round(remaining / months_left, 1) if remaining and months_left else None),
    )
    return result


async def set_goal(session: AsyncSession, year: int, books: int) -> None:
    goal = await session.get(ReadingGoal, year)
    if goal is None:
        session.add(ReadingGoal(year=year, books=books))
    else:
        goal.books = books
    await session.commit()


async def delete_goal(session: AsyncSession, year: int) -> bool:
    goal = await session.get(ReadingGoal, year)
    if goal is None:
        return False
    await session.delete(goal)
    await session.commit()
    return True


# ── year in review ────────────────────────────────────────────────────────────


async def years_with_data(session: AsyncSession) -> list[int]:
    """Years that have reading sessions, finished books or a goal, newest first."""
    years = {date.today().year}
    rows = await session.execute(
        select(func.strftime("%Y", ReadingSession.start_time))
        .where(ReadingSession.start_time.is_not(None), ReadingSession.dismissed == False)  # noqa: E712
        .distinct()
    )
    years |= {int(y) for (y,) in rows if y}
    years |= set((await session.execute(select(ReadingGoal.year))).scalars())
    for book in await get_books_completed(session):
        if book["completed_at"]:
            years.add(book["completed_at"].year)
    return sorted(years, reverse=True)


def _time_of_day(hour: int) -> str:
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


def _longest_run(days: list[date]) -> int:
    best = run = 0
    prev: date | None = None
    for d in days:
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return best


async def year_review(session: AsyncSession, year: int) -> dict:
    start, end = _year_bounds(year)
    completed = await get_books_completed(session, start, end)
    completed.sort(key=lambda b: b["completed_at"])
    ids = [b["book_id"] for b in completed]
    books = {
        b.id: b for b in (await session.execute(select(Book).where(Book.id.in_(ids)))).scalars()
    }

    sessions = (
        await session.execute(
            select(
                ReadingSession.book_id,
                ReadingSession.start_time,
                ReadingSession.duration,
                ReadingSession.pages_read,
            ).where(
                ReadingSession.dismissed == False,  # noqa: E712
                ReadingSession.start_time.is_not(None),
                ReadingSession.start_time >= start,
                ReadingSession.start_time <= end,
            )
        )
    ).all()

    months = [{"month": m, "books": 0, "seconds": 0, "pages": 0} for m in range(1, 13)]
    for b in completed:
        months[b["completed_at"].month - 1]["books"] += 1
    per_day: Counter[date] = Counter()
    time_of_day: Counter[str] = Counter()
    first_session: dict[str, datetime] = {}
    for book_id, started, duration, pages in sessions:
        seconds = duration or 0
        months[started.month - 1]["seconds"] += seconds
        months[started.month - 1]["pages"] += pages or 0
        if seconds > 0:
            per_day[started.date()] += seconds
        time_of_day[_time_of_day(started.hour)] += seconds
        if book_id not in first_session or started < first_session[book_id]:
            first_session[book_id] = started

    # First sessions before this year still count for how long a book took.
    if ids:
        for book_id, first in await session.execute(
            select(ReadingSession.book_id, func.min(ReadingSession.start_time))
            .where(
                ReadingSession.book_id.in_(ids),
                ReadingSession.dismissed == False,  # noqa: E712
                ReadingSession.start_time.is_not(None),
            )
            .group_by(ReadingSession.book_id)
        ):
            if isinstance(first, str):
                first = datetime.fromisoformat(first)
            first_session[book_id] = first

    genres: Counter[str] = Counter()
    if ids:
        for (name,) in await session.execute(
            select(Genre.name).join(BookGenre).where(BookGenre.book_id.in_(ids))
        ):
            genres[name] += 1
    authors = Counter(books[i].author for i in ids if i in books and books[i].author)

    finished = []
    for b in completed:
        book = books.get(b["book_id"])
        first = first_session.get(b["book_id"])
        days = (b["completed_at"].date() - first.date()).days + 1 if first else None
        finished.append(
            {
                "id": b["book_id"],
                "title": b["title"],
                "author": b["author"],
                "cover_path": b["cover_path"],
                "completed_at": b["completed_at"],
                "rating": book.rating if book else None,
                "page_count": book.page_count if book else None,
                "days_to_read": days if days and days > 0 else None,
            }
        )

    def pick(key, reverse=True):
        candidates = [f for f in finished if f[key] is not None]
        if not candidates:
            return None
        return sorted(candidates, key=lambda f: f[key], reverse=reverse)[0]

    busiest_day = max(per_day.items(), key=lambda kv: kv[1]) if per_day else None
    total_seconds = sum(m["seconds"] for m in months)
    return {
        "year": year,
        "goal": await goal_progress(session, year),
        "totals": {
            "books": len(finished),
            "pages": sum(m["pages"] for m in months),
            "seconds": total_seconds,
            "sessions": len(sessions),
            "reading_days": len(per_day),
            "longest_streak": _longest_run(sorted(per_day)),
        },
        "months": months,
        "books": finished,
        "top_authors": [{"name": n, "books": c} for n, c in authors.most_common(5)],
        "top_genres": [{"name": n, "books": c} for n, c in genres.most_common(5)],
        "highlights": {
            "longest_book": pick("page_count"),
            "shortest_book": pick("page_count", reverse=False),
            "fastest_read": pick("days_to_read", reverse=False),
            "top_rated": pick("rating"),
            "busiest_day": (
                {"date": busiest_day[0].isoformat(), "seconds": busiest_day[1]}
                if busiest_day
                else None
            ),
            "favourite_time": (
                time_of_day.most_common(1)[0][0] if total_seconds and time_of_day else None
            ),
        },
        "average_rating": (
            round(sum(r for r in (f["rating"] for f in finished) if r) / n, 2)
            if (n := sum(1 for f in finished if f["rating"]))
            else None
        ),
        "average_days_to_read": (
            math.ceil(sum(d) / len(d))
            if (d := [f["days_to_read"] for f in finished if f["days_to_read"]])
            else None
        ),
    }
