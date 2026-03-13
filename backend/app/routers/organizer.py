from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.organizer import ApplyRequest, OrganizerResultResponse, RenameLogResponse
from app.services.organizer import (
    ShelfNotFound,
    list_rename_logs,
    organize_shelf,
)

router = APIRouter(prefix="/organize", tags=["organize"])


def _to_response(r) -> OrganizerResultResponse:
    return OrganizerResultResponse(
        book_id=r.book_id,
        book_title=r.book_title,
        old_path=r.old_path,
        new_path=r.new_path,
        moved=r.moved,
        already_correct=r.already_correct,
        error=r.error,
    )


@router.get("/preview", response_model=list[OrganizerResultResponse])
async def preview_endpoint(
    shelf_id: int = Query(...),
    template: str | None = Query(None),
    seq_pad: int = Query(2),
    session: AsyncSession = Depends(get_session),
):
    """Dry-run: compute new paths for all books on a shelf without moving files."""
    try:
        results = await organize_shelf(
            session, shelf_id, template=template, seq_pad=seq_pad, dry_run=True
        )
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return [_to_response(r) for r in results]


@router.post("/apply", response_model=list[OrganizerResultResponse])
async def apply_endpoint(
    data: ApplyRequest,
    session: AsyncSession = Depends(get_session),
):
    """Execute organization: move files to their computed paths."""
    try:
        results = await organize_shelf(
            session, data.shelf_id, template=data.template, seq_pad=data.seq_pad, dry_run=False
        )
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return [_to_response(r) for r in results]


@router.get("/log", response_model=list[RenameLogResponse])
async def log_endpoint(
    shelf_id: int | None = Query(None),
    book_id: str | None = Query(None),
    limit: int = Query(100),
    session: AsyncSession = Depends(get_session),
):
    """List rename history."""
    logs = await list_rename_logs(session, shelf_id=shelf_id, book_id=book_id, limit=limit)
    return logs
