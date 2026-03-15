"""Data management API router (step 4.5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.data_mgmt import (
    BulkResolveResponse,
    DuplicateBookGroup,
    DuplicateSessionGroup,
    ImportLogResponse,
    LinkUnmatchedRequest,
    MergeBooksRequest,
    SessionLogResponse,
    SetDismissedRequest,
    UnmatchedEntryOut,
)
from app.services import data_mgmt_service as svc

router = APIRouter(prefix="/data-mgmt", tags=["data-management"])


# ---------------------------------------------------------------------------
# Duplicate Sessions
# ---------------------------------------------------------------------------


@router.get("/duplicate-sessions", response_model=list[DuplicateSessionGroup])
async def list_duplicate_sessions(
    session: AsyncSession = Depends(get_session),
) -> list[DuplicateSessionGroup]:
    """List all books that have dismissed (duplicate) reading sessions."""
    groups = await svc.get_duplicate_session_groups(session)
    return [DuplicateSessionGroup(**g) for g in groups]


@router.patch("/sessions/{session_id}/dismissed")
async def patch_session_dismissed(
    session_id: int,
    body: SetDismissedRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Set or clear the dismissed flag on a reading session."""
    ok = await svc.set_session_dismissed(db, session_id, body.dismissed)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok"}


@router.post("/duplicate-sessions/bulk-resolve", response_model=BulkResolveResponse)
async def bulk_resolve_duplicates(
    session: AsyncSession = Depends(get_session),
) -> BulkResolveResponse:
    """Auto-dismiss all SDR sessions that overlap with stats_db sessions."""
    dismissed = await svc.bulk_resolve_duplicates(session)
    return BulkResolveResponse(dismissed=dismissed)


# ---------------------------------------------------------------------------
# Unmatched KOReader Entries
# ---------------------------------------------------------------------------


@router.get("/unmatched", response_model=list[UnmatchedEntryOut])
async def list_unmatched(
    include_dismissed: bool = Query(False),
    session: AsyncSession = Depends(get_session),
) -> list[UnmatchedEntryOut]:
    """List KOReader entries that could not be matched to a book."""
    entries = await svc.get_unmatched_entries(session, include_dismissed=include_dismissed)
    return [UnmatchedEntryOut.model_validate(e) for e in entries]


@router.post("/unmatched/{entry_id}/link")
async def link_unmatched(
    entry_id: int,
    body: LinkUnmatchedRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Link an unmatched KOReader entry to a book."""
    ok = await svc.link_unmatched_to_book(session, entry_id, body.book_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry or book not found")
    return {"status": "ok"}


@router.post("/unmatched/{entry_id}/dismiss")
async def dismiss_unmatched(
    entry_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Dismiss an unmatched KOReader entry."""
    ok = await svc.dismiss_unmatched_entry(session, entry_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Duplicate Books
# ---------------------------------------------------------------------------


@router.get("/duplicate-books", response_model=list[DuplicateBookGroup])
async def list_duplicate_books(
    session: AsyncSession = Depends(get_session),
) -> list[DuplicateBookGroup]:
    """Find books with identical (normalized) title+author."""
    groups = await svc.get_duplicate_book_groups(session)
    return [DuplicateBookGroup(**g) for g in groups]


@router.post("/books/merge")
async def merge_books(
    body: MergeBooksRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Merge reading data from discard into keep, then delete discard."""
    ok = await svc.merge_books(session, body.keep_id, body.discard_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Book(s) not found or same ID given")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Import Log
# ---------------------------------------------------------------------------


@router.get("/sessions-log", response_model=SessionLogResponse)
async def get_session_log(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    source: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> SessionLogResponse:
    """Return all reading sessions with book metadata."""
    data = await svc.get_session_log(
        session,
        limit=limit,
        offset=offset,
        search=search or None,
        source=source or None,
    )
    return SessionLogResponse(**data)


@router.get("/import-log", response_model=ImportLogResponse)
async def get_import_log(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> ImportLogResponse:
    """Return recent book hash history (import activity log)."""
    data = await svc.get_import_log(session, limit=limit, offset=offset, search=search or None)
    return ImportLogResponse(**data)
