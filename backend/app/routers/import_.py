from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.schemas.import_ import BackfillCoversResponse, ScanProgressResponse, ScanStatusResponse
from app.services.scheduler import Scheduler

router = APIRouter(prefix="/import", tags=["import"])


def _get_scheduler(request: Request) -> Scheduler:
    return request.app.state.scheduler


@router.post("/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan_endpoint(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Manually trigger a library scan. Returns 202 immediately."""
    scheduler: Scheduler = _get_scheduler(request)
    settings = get_settings()
    from app.database import get_session_factory

    await scheduler.trigger(get_session_factory(), settings, settings.covers_dir)
    return {"message": "Scan triggered"}


@router.post("/backfill-covers", response_model=BackfillCoversResponse)
async def backfill_covers_endpoint(
    session: AsyncSession = Depends(get_session),
):
    """Re-extract covers for all books missing a cover image."""
    from app.services.book_service import backfill_covers

    settings = get_settings()
    counts = await backfill_covers(session, settings.covers_dir)
    return BackfillCoversResponse(**counts)


@router.get("/status", response_model=ScanStatusResponse)
async def scan_status_endpoint(request: Request):
    """Return current scan status."""
    scheduler: Scheduler = _get_scheduler(request)
    s = scheduler.status
    progress = None
    if s.progress is not None:
        p = s.progress
        progress = ScanProgressResponse(
            total=p.total,
            processed=p.processed,
            created=p.created,
            updated=p.updated,
            skipped=p.skipped,
            errors=p.errors,
        )
    return ScanStatusResponse(
        is_running=s.is_running,
        last_scan_at=s.last_scan_at,
        progress=progress,
        error=s.error,
    )
