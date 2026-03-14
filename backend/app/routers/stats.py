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
    """Completed books (progress ≥ 1.0), most recent first."""
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
