from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session, get_session_factory
from app.schemas.serial import (
    AutoSplitConfig,
    ChapterFetchJobResponse,
    ChapterFetchRequest,
    ChapterFetchStatusResponse,
    ChapterResponse,
    PendingChapterBatchStatusResponse,
    PendingChapterFetchResponse,
    SerialCreate,
    SerialDashboardResponse,
    SerialResponse,
    SerialUpdate,
    SingleVolumeCreate,
    VolumeConfigCreate,
    VolumePreviewResponse,
    VolumeResponse,
    VolumeUpdate,
)
from app.scrapers.registry import get_adapter, list_adapter_names
from app.services.serial_service import (
    ChapterFetchAlreadyRunning,
    ChapterFetchBatchBusy,
    PendingChapterBatchAlreadyRunning,
    ScrapingError,
    SerialAlreadyExists,
    SerialNotFound,
    VolumeGenerationError,
    acknowledge_serial,
    add_serial,
    add_single_volume,
    auto_split_volumes,
    check_all_serials_for_updates,
    configure_volumes,
    delete_serial,
    delete_volume,
    fetch_pending_chapters,
    generate_all_volumes,
    generate_volume,
    get_chapter_fetch_status,
    get_pending_chapter_batch_status,
    get_serial,
    get_volume_metrics,
    list_chapter_responses,
    list_serials,
    list_serials_for_dashboard,
    list_volumes,
    preview_volume_ranges,
    rebuild_volume,
    refresh_serial_cover,
    start_chapter_fetch_job,
    start_pending_chapter_batch,
    update_from_source,
    update_serial,
    update_volume,
    upload_serial_cover,
    upload_volume_cover,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["serials"])

WORDS_PER_PAGE = 280


def _enrich_volumes(volumes: list[object], metrics: dict[int, object]) -> list[VolumeResponse]:
    """Build VolumeResponse list with derived volume metrics."""
    result: list[VolumeResponse] = []
    for v in volumes:
        resp = VolumeResponse.model_validate(v)
        metric = metrics.get(resp.id)
        if metric is not None:
            total_words = int(getattr(metric, "total_words"))
            resp.total_words = total_words
            resp.estimated_pages = (
                max(1, total_words // WORDS_PER_PAGE) if total_words > 0 else None
            )
            resp.chapter_count = int(getattr(metric, "chapter_count"))
            resp.fetched_chapter_count = int(getattr(metric, "fetched_chapter_count"))
            resp.is_partial = bool(getattr(metric, "is_partial"))
            resp.stubbed_missing_count = int(getattr(metric, "stubbed_missing_count"))
        result.append(resp)
    return result


# ---------------------------------------------------------------------------
# Serials CRUD
# ---------------------------------------------------------------------------


@router.get("/serials/adapters")
async def list_adapters_endpoint():
    return list_adapter_names()


@router.get("/serials/detect-adapter")
async def detect_adapter_endpoint(url: str = Query(...)):
    adapter = get_adapter(url)
    return {"adapter": adapter.name if adapter else None}


@router.post("/serials", response_model=SerialResponse, status_code=status.HTTP_201_CREATED)
async def add_serial_endpoint(body: SerialCreate, session: AsyncSession = Depends(get_session)):
    try:
        serial = await add_serial(session, body)
    except SerialAlreadyExists as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.get("/serials", response_model=list[SerialResponse])
async def list_serials_endpoint(session: AsyncSession = Depends(get_session)):
    items = await list_serials(session)
    return [SerialResponse.model_validate(s) for s in items]


@router.get("/serials/dashboard", response_model=list[SerialDashboardResponse])
async def serials_dashboard_endpoint(session: AsyncSession = Depends(get_session)):
    entries = await list_serials_for_dashboard(session)
    return [SerialDashboardResponse(**entry.__dict__) for entry in entries]


@router.get(
    "/serials/fetch-pending-status",
    response_model=PendingChapterBatchStatusResponse,
)
async def fetch_pending_status_endpoint():
    return await get_pending_chapter_batch_status()


@router.post(
    "/serials/fetch-pending",
    response_model=PendingChapterBatchStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def fetch_all_pending_endpoint(request: Request):
    session_factory = getattr(
        request.app.state,
        "serial_fetch_session_factory",
        get_session_factory(),
    )
    try:
        return await start_pending_chapter_batch(session_factory)
    except PendingChapterBatchAlreadyRunning as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.post("/serials/check-updates")
async def check_serial_updates_endpoint(request: Request):
    session_factory = getattr(
        request.app.state,
        "serial_fetch_session_factory",
        get_session_factory(),
    )
    result = await check_all_serials_for_updates(session_factory)
    return result


@router.get("/serials/{serial_id}", response_model=SerialResponse)
async def get_serial_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    try:
        serial = await get_serial(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.patch("/serials/{serial_id}", response_model=SerialResponse)
async def update_serial_endpoint(
    serial_id: int, body: SerialUpdate, session: AsyncSession = Depends(get_session)
):
    try:
        serial = await update_serial(session, serial_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.get("/serials/{serial_id}/cover")
async def get_serial_cover_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    cache_headers = {"Cache-Control": "no-store"}
    try:
        serial = await get_serial(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
            headers=cache_headers,
        )
    if not serial.cover_path or not Path(serial.cover_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No cover available",
            headers=cache_headers,
        )
    return FileResponse(
        serial.cover_path,
        media_type="image/jpeg",
        headers=cache_headers,
    )


@router.post("/serials/{serial_id}/upload-cover", response_model=SerialResponse)
async def upload_serial_cover_endpoint(
    serial_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    content = await file.read()
    if file.filename and "." in file.filename:
        suffix = f".{file.filename.rsplit('.', 1)[-1]}"
    else:
        suffix = ".jpg"
    try:
        serial = await upload_serial_cover(session, serial_id, content, suffix)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.post("/serials/{serial_id}/refresh-cover", response_model=SerialResponse)
async def refresh_serial_cover_endpoint(
    serial_id: int,
    session: AsyncSession = Depends(get_session),
):
    try:
        serial = await refresh_serial_cover(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.delete("/serials/{serial_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_serial_endpoint(
    serial_id: int,
    delete_files: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
):
    try:
        await delete_serial(session, serial_id, delete_files=delete_files)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/serials/{serial_id}/acknowledge", status_code=status.HTTP_204_NO_CONTENT)
async def acknowledge_serial_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await acknowledge_serial(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------


@router.get("/serials/{serial_id}/chapters", response_model=list[ChapterResponse])
async def list_chapters_endpoint(
    serial_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
):
    try:
        chapters = await list_chapter_responses(
            session,
            serial_id,
            offset=offset,
            limit=limit,
        )
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return chapters


@router.post(
    "/serials/{serial_id}/chapters/fetch",
    response_model=ChapterFetchJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def fetch_chapters_endpoint(
    serial_id: int,
    body: ChapterFetchRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    try:
        session_factory = getattr(
            request.app.state,
            "serial_fetch_session_factory",
            get_session_factory(),
        )
        job = await start_chapter_fetch_job(
            session,
            session_factory,
            serial_id,
            body.start,
            body.end,
        )
    except ChapterFetchAlreadyRunning as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ChapterFetchBatchBusy as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    return job


@router.post(
    "/serials/{serial_id}/chapters/fetch-pending",
    response_model=PendingChapterFetchResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def fetch_pending_chapters_endpoint(
    serial_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    try:
        session_factory = getattr(
            request.app.state,
            "serial_fetch_session_factory",
            get_session_factory(),
        )
        return await fetch_pending_chapters(session, session_factory, serial_id)
    except ChapterFetchAlreadyRunning as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ChapterFetchBatchBusy as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get(
    "/serials/{serial_id}/chapters/fetch-status",
    response_model=ChapterFetchStatusResponse,
)
async def fetch_chapters_status_endpoint(
    serial_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        return await get_chapter_fetch_status(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post(
    "/serials/{serial_id}/volumes/preview",
    response_model=list[VolumePreviewResponse],
)
async def preview_volumes_endpoint(
    serial_id: int,
    body: VolumeConfigCreate,
    session: AsyncSession = Depends(get_session),
):
    try:
        return await preview_volume_ranges(session, serial_id, body.splits)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ---------------------------------------------------------------------------
# Source updates
# ---------------------------------------------------------------------------


@router.post("/serials/{serial_id}/update")
async def update_from_source_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    try:
        result = await update_from_source(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    return result


# ---------------------------------------------------------------------------
# Volumes
# ---------------------------------------------------------------------------


@router.post("/serials/{serial_id}/volumes", response_model=list[VolumeResponse], status_code=201)
async def configure_volumes_endpoint(
    serial_id: int, body: VolumeConfigCreate, session: AsyncSession = Depends(get_session)
):
    try:
        volumes = await configure_volumes(session, serial_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        log.exception("Failed to configure volumes for serial %d", serial_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes(volumes, metrics)


@router.post(
    "/serials/{serial_id}/volumes/auto", response_model=list[VolumeResponse], status_code=201
)
async def auto_split_volumes_endpoint(
    serial_id: int, body: AutoSplitConfig, session: AsyncSession = Depends(get_session)
):
    try:
        volumes = await auto_split_volumes(session, serial_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes(volumes, metrics)


@router.post("/serials/{serial_id}/volumes/add", response_model=VolumeResponse, status_code=201)
async def add_single_volume_endpoint(
    serial_id: int, body: SingleVolumeCreate, session: AsyncSession = Depends(get_session)
):
    try:
        vol = await add_single_volume(session, serial_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes([vol], metrics)[0]


@router.get("/serials/{serial_id}/volumes", response_model=list[VolumeResponse])
async def list_volumes_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    try:
        volumes = await list_volumes(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes(volumes, metrics)


@router.patch("/serials/{serial_id}/volumes/{volume_id}", response_model=VolumeResponse)
async def update_volume_endpoint(
    serial_id: int,
    volume_id: int,
    body: VolumeUpdate,
    session: AsyncSession = Depends(get_session),
):
    try:
        vol = await update_volume(session, serial_id, volume_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes([vol], metrics)[0]


@router.delete("/serials/{serial_id}/volumes/{volume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_volume_endpoint(
    serial_id: int,
    volume_id: int,
    delete_book: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
):
    try:
        await delete_volume(session, serial_id, volume_id, delete_book=delete_book)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/serials/{serial_id}/volumes/{volume_id}/upload-cover", response_model=VolumeResponse)
async def upload_volume_cover_endpoint(
    serial_id: int,
    volume_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    content = await file.read()
    if file.filename and "." in file.filename:
        suffix = f".{file.filename.rsplit('.', 1)[-1]}"
    else:
        suffix = ".jpg"
    try:
        vol = await upload_volume_cover(session, serial_id, volume_id, content, suffix)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes([vol], metrics)[0]


@router.post("/serials/{serial_id}/volumes/{volume_id}/generate", response_model=VolumeResponse)
async def generate_volume_endpoint(
    serial_id: int,
    volume_id: int,
    shelf_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    try:
        vol = await generate_volume(session, serial_id, volume_id, shelf_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except VolumeGenerationError as exc:
        log.error("Volume generation error: %s", exc)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except Exception as exc:
        log.exception("Unexpected error generating volume %d for serial %d", volume_id, serial_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes([vol], metrics)[0]


@router.post("/serials/{serial_id}/volumes/generate-all", response_model=list[VolumeResponse])
async def generate_all_volumes_endpoint(
    serial_id: int,
    shelf_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    try:
        volumes = await generate_all_volumes(session, serial_id, shelf_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes(volumes, metrics)


@router.post("/serials/{serial_id}/volumes/{volume_id}/rebuild", response_model=VolumeResponse)
async def rebuild_volume_endpoint(
    serial_id: int,
    volume_id: int,
    session: AsyncSession = Depends(get_session),
):
    try:
        vol = await rebuild_volume(session, serial_id, volume_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except VolumeGenerationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    metrics = await get_volume_metrics(session, serial_id)
    return _enrich_volumes([vol], metrics)[0]
