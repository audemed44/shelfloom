"""Reading data API router."""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.reading import Highlight, ReadingProgress, ReadingSession
from app.schemas.reading import (
    BookReadingSummary,
    HighlightOut,
    ReadingProgressOut,
    ReadingSessionOut,
)
from app.services.book_service import BookNotFound, get_book

router = APIRouter(prefix="/books", tags=["reading"])


@router.post("/{book_id}/mark-read", status_code=200)
async def mark_read(
    book_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Mark a book as fully read (upserts a manual progress record at 100%)."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    result = await session.execute(
        select(ReadingProgress).where(
            ReadingProgress.book_id == book_id,
            ReadingProgress.device == "manual",
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        record = ReadingProgress(book_id=book_id, device="manual", progress=100.0)
        session.add(record)
    else:
        record.progress = 100.0
    await session.commit()
    return {"status": "ok"}


@router.delete("/{book_id}/mark-read", status_code=204)
async def unmark_read(
    book_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove the manual 'read' mark (leaves KOReader progress intact)."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    result = await session.execute(
        select(ReadingProgress).where(
            ReadingProgress.book_id == book_id,
            ReadingProgress.device == "manual",
        )
    )
    record = result.scalar_one_or_none()
    if record:
        await session.delete(record)
        await session.commit()


@router.get("/{book_id}/highlights")
async def get_highlights(
    book_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated list of highlights for a book."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    offset = (page - 1) * per_page

    total_result = await session.execute(select(func.count()).where(Highlight.book_id == book_id))
    total = total_result.scalar_one()

    result = await session.execute(
        select(Highlight)
        .where(Highlight.book_id == book_id)
        .order_by(Highlight.page, Highlight.id)
        .offset(offset)
        .limit(per_page)
    )
    highlights = result.scalars().all()

    return {
        "items": [HighlightOut.model_validate(h) for h in highlights],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, math.ceil(total / per_page)),
    }


@router.get("/{book_id}/sessions")
async def get_sessions(
    book_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Reading session history for a book (dismissed sessions excluded)."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    offset = (page - 1) * per_page

    total_result = await session.execute(
        select(func.count()).where(
            ReadingSession.book_id == book_id,
            ReadingSession.dismissed == False,  # noqa: E712
        )
    )
    total = total_result.scalar_one()

    result = await session.execute(
        select(ReadingSession)
        .where(
            ReadingSession.book_id == book_id,
            ReadingSession.dismissed == False,  # noqa: E712
        )
        .order_by(ReadingSession.start_time.desc())
        .offset(offset)
        .limit(per_page)
    )
    sessions = result.scalars().all()

    return {
        "items": [ReadingSessionOut.model_validate(s) for s in sessions],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, math.ceil(total / per_page)),
    }


@router.get("/{book_id}/progress")
async def get_progress(
    book_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[ReadingProgressOut]:
    """Current reading progress for all devices."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    result = await session.execute(
        select(ReadingProgress)
        .where(ReadingProgress.book_id == book_id)
        .order_by(ReadingProgress.updated_at.desc())
    )
    records = result.scalars().all()
    return [ReadingProgressOut.model_validate(r) for r in records]


@router.get("/{book_id}/reading-summary", response_model=BookReadingSummary)
async def get_reading_summary(
    book_id: str,
    session: AsyncSession = Depends(get_session),
) -> BookReadingSummary:
    """Reading summary for a book."""
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Count non-dismissed sessions
    sessions_result = await session.execute(
        select(ReadingSession).where(
            ReadingSession.book_id == book_id,
            ReadingSession.dismissed == False,  # noqa: E712
        )
    )
    sessions = sessions_result.scalars().all()
    total_sessions = len(sessions)
    total_time = sum(s.duration or 0 for s in sessions)

    # Latest progress
    progress_result = await session.execute(
        select(ReadingProgress)
        .where(ReadingProgress.book_id == book_id)
        .order_by(ReadingProgress.updated_at.desc())
    )
    latest_progress = progress_result.scalars().first()
    percent_finished = latest_progress.progress if latest_progress else None

    return BookReadingSummary(
        total_sessions=total_sessions,
        total_time_seconds=total_time,
        percent_finished=percent_finished,
    )
