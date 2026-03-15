"""Stats API router."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import stats_service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
async def overview(session: AsyncSession = Depends(get_session)) -> dict:
    """Totals: books owned, books read, total reading time, total pages, current streak."""
    return await stats_service.get_overview(session)


@router.get("/reading-time")
async def reading_time(
    granularity: Literal["day", "week", "month"] = Query("day"),
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Reading time (seconds) time series."""
    return await stats_service.get_time_series(session, "duration", granularity, from_, to_)


@router.get("/pages")
async def pages_over_time(
    granularity: Literal["day", "week", "month"] = Query("day"),
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Pages read time series."""
    return await stats_service.get_time_series(session, "pages", granularity, from_, to_)


@router.get("/books-completed")
async def books_completed(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Completed books (progress ≥ 99), most recent first."""
    return await stats_service.get_books_completed(session)


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
async def distribution(session: AsyncSession = Depends(get_session)) -> dict:
    """Reading time by hour-of-day and day-of-week."""
    return await stats_service.get_distribution(session)


@router.get("/by-author")
async def by_author(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Reading time per author, sorted descending."""
    return await stats_service.get_by_author(session)


@router.get("/by-tag")
async def by_tag(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Reading time per tag, sorted descending."""
    return await stats_service.get_by_tag(session)


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
