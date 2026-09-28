"""Stats API router."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import stats_service


def _naive(dt: datetime | None) -> datetime | None:
    """Naive UTC, to compare against the naive UTC times stored in SQLite."""
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
async def overview(
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Totals: books owned, books read, total reading time, total pages, current streak."""
    return await stats_service.get_overview(session, from_dt=_naive(from_), to_dt=_naive(to_))


@router.get("/reading-time")
async def reading_time(
    granularity: Literal["day", "week", "month"] = Query("day"),
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Reading time (seconds) time series."""
    return await stats_service.get_time_series(
        session, "duration", granularity, _naive(from_), _naive(to_)
    )


@router.get("/pages")
async def pages_over_time(
    granularity: Literal["day", "week", "month"] = Query("day"),
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Pages read time series."""
    return await stats_service.get_time_series(
        session, "pages", granularity, _naive(from_), _naive(to_)
    )


@router.get("/books-completed")
async def books_completed(
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Completed books (progress ≥ 99), most recent first."""
    return await stats_service.get_books_completed(
        session, from_dt=_naive(from_), to_dt=_naive(to_)
    )


@router.get("/pending-verdicts")
async def pending_verdicts(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Finished books still waiting for a rating or review, most recent first."""
    return await stats_service.get_pending_verdicts(session)


@router.get("/streaks")
async def streaks(session: AsyncSession = Depends(get_session)) -> dict:
    """Current and longest reading streaks with full history."""
    return await stats_service.get_streaks(session)


@router.get("/heatmap")
async def heatmap(
    year: Annotated[int, Query(ge=2000, le=2100)] = 2024,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Daily reading seconds for every day of the given year."""
    return await stats_service.get_heatmap(session, year)


@router.get("/distribution")
async def distribution(
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Reading time by local hour-of-day and day-of-week."""
    return await stats_service.get_distribution(session, _naive(from_), _naive(to_))


@router.get("/by-author")
async def by_author(
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Reading time per author, sorted descending."""
    return await stats_service.get_by_author(session, _naive(from_), _naive(to_))


@router.get("/by-tag")
async def by_tag(
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Reading time per tag, sorted descending."""
    return await stats_service.get_by_tag(session, _naive(from_), _naive(to_))


@router.get("/recent-sessions")
async def recent_sessions(
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Most recent non-dismissed reading sessions with book info."""
    return await stats_service.get_recent_sessions(session, limit)


@router.get("/calendar")
async def calendar_month(
    year: Annotated[int, Query(ge=2000, le=2100)] = 2024,
    month: Annotated[int, Query(ge=1, le=12)] = 1,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Sessions grouped by day for a calendar month, with book info."""
    return await stats_service.get_calendar_month(session, year, month)


@router.get("/by-book/{book_id}")
async def by_book(
    book_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Per-book analytics: sessions, time, pages, reading speed."""
    result = await stats_service.get_book_stats(session, book_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return result


# ── goals and year in review ──────────────────────────────────────────────────


class GoalIn(BaseModel):
    books: int = Field(ge=1, le=1000)


@router.get("/years")
async def years(session: AsyncSession = Depends(get_session)) -> list[int]:
    """Years with reading data (and the current year), newest first."""
    from app.services.year_review import years_with_data

    return await years_with_data(session)


@router.get("/year/{year}")
async def year_in_review(year: int, session: AsyncSession = Depends(get_session)) -> dict:
    """Everything read in a calendar year: totals, months, books and highlights."""
    from app.services.year_review import year_review

    if not 1900 <= year <= 2200:
        raise HTTPException(status_code=422, detail="Year out of range")
    return await year_review(session, year)


@router.get("/goal/{year}")
async def get_goal(year: int, session: AsyncSession = Depends(get_session)) -> dict:
    """The year's reading goal and progress (target is null if none is set)."""
    from app.services.year_review import goal_progress

    return await goal_progress(session, year)


@router.put("/goal/{year}")
async def put_goal(year: int, body: GoalIn, session: AsyncSession = Depends(get_session)) -> dict:
    from app.services.year_review import goal_progress, set_goal

    await set_goal(session, year, body.books)
    return await goal_progress(session, year)


@router.delete("/goal/{year}", status_code=204)
async def remove_goal(year: int, session: AsyncSession = Depends(get_session)) -> None:
    from app.services.year_review import delete_goal

    if not await delete_goal(session, year):
        raise HTTPException(status_code=404, detail="No goal for that year")
