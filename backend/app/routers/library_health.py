"""Library health check and generated covers."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.services.book_service import BookNotFound
from app.services.library_health import (
    generate_cover,
    generate_covers,
    get_library_health,
    preview_cover,
    record_missing_fingerprints,
    remove_missing_books,
)

router = APIRouter(tags=["library-health"])


class HealthBook(BaseModel):
    id: str
    title: str
    author: str | None
    format: str | None
    cover_path: str | None
    detail: str | None = None


class HealthIssue(BaseModel):
    key: str
    severity: str  # "error" | "warning" | "info"
    title: str
    ok_title: str  # how the check reads when nothing was found
    description: str
    count: int
    books: list[HealthBook]


class HealthLink(BaseModel):
    key: str
    severity: str
    title: str
    count: int
    tab: str  # Data Management tab that handles it


class HealthReport(BaseModel):
    checked_at: datetime
    total_books: int
    issues: list[HealthIssue]
    links: list[HealthLink]


class BookIds(BaseModel):
    book_ids: list[str]


class GenerateCoversRequest(BaseModel):
    book_ids: list[str] | None = None  # None: every book without a cover
    embed: bool = True  # also write the cover into the EPUB file


class GenerateCoverRequest(BaseModel):
    embed: bool = True


@router.get("/library-health", response_model=HealthReport)
async def library_health(session: AsyncSession = Depends(get_session)):
    return await get_library_health(session)


@router.post("/library-health/remove-missing")
async def remove_missing(body: BookIds, session: AsyncSession = Depends(get_session)):
    """Remove library records whose file is gone (files that exist are kept)."""
    return {"removed": await remove_missing_books(session, body.book_ids)}


@router.post("/library-health/fingerprints")
async def fingerprints(session: AsyncSession = Depends(get_session)):
    """Record KOReader fingerprints that are missing."""
    return {"updated": await record_missing_fingerprints(session)}


@router.post("/library-health/generate-covers")
async def generate_many(body: GenerateCoversRequest, session: AsyncSession = Depends(get_session)):
    return await generate_covers(
        session, get_settings().covers_dir, book_ids=body.book_ids, embed=body.embed
    )


@router.get("/books/{book_id}/generated-cover")
async def generated_cover_preview(book_id: str, session: AsyncSession = Depends(get_session)):
    """Preview the cover Shelfloom would make (nothing is saved)."""
    try:
        data = await preview_cover(session, book_id)
    except BookNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/books/{book_id}/generate-cover")
async def generate_one(
    book_id: str,
    body: GenerateCoverRequest | None = None,
    session: AsyncSession = Depends(get_session),
):
    """Make a cover for this book and use it."""
    try:
        book = await generate_cover(
            session,
            book_id,
            get_settings().covers_dir,
            embed=(body or GenerateCoverRequest()).embed,
        )
    except BookNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"id": book.id, "cover_path": book.cover_path}
