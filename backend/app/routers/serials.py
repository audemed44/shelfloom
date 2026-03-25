from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.serial import (
    AutoSplitConfig,
    ChapterFetchRequest,
    ChapterResponse,
    SerialCreate,
    SerialResponse,
    SerialUpdate,
    SingleVolumeCreate,
    VolumeConfigCreate,
    VolumeResponse,
    VolumeUpdate,
)
from app.scrapers.registry import get_adapter, list_adapter_names
from app.services.serial_service import (
    ScrapingError,
    SerialAlreadyExists,
    SerialNotFound,
    VolumeGenerationError,
    add_serial,
    add_single_volume,
    auto_split_volumes,
    configure_volumes,
    delete_serial,
    delete_volume,
    fetch_chapters_content,
    generate_all_volumes,
    generate_volume,
    get_serial,
    get_volume_word_counts,
    list_chapters,
    list_serials,
    list_volumes,
    rebuild_volume,
    refresh_serial_cover,
    update_from_source,
    update_serial,
    update_volume,
    upload_serial_cover,
    upload_volume_cover,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["serials"])

WORDS_PER_PAGE = 250


def _enrich_volumes(volumes: list[object], word_counts: dict[int, int]) -> list[VolumeResponse]:
    """Build VolumeResponse list with estimated_pages and total_words."""
    result: list[VolumeResponse] = []
    for v in volumes:
        resp = VolumeResponse.model_validate(v)
        words = word_counts.get(resp.id)
        if words is not None and words > 0:
            resp.total_words = words
            resp.estimated_pages = max(1, words // WORDS_PER_PAGE)
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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return SerialResponse.model_validate(serial)


@router.get("/serials", response_model=list[SerialResponse])
async def list_serials_endpoint(session: AsyncSession = Depends(get_session)):
    items = await list_serials(session)
    return [SerialResponse.model_validate(s) for s in items]


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
    try:
        serial = await get_serial(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if not serial.cover_path or not Path(serial.cover_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No cover available")
    return FileResponse(serial.cover_path, media_type="image/jpeg")


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
        chapters = await list_chapters(session, serial_id, offset=offset, limit=limit)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return [ChapterResponse.from_orm(ch) for ch in chapters]


@router.post("/serials/{serial_id}/chapters/fetch", response_model=list[ChapterResponse])
async def fetch_chapters_endpoint(
    serial_id: int, body: ChapterFetchRequest, session: AsyncSession = Depends(get_session)
):
    try:
        chapters = await fetch_chapters_content(session, serial_id, body.start, body.end)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return [ChapterResponse.from_orm(ch) for ch in chapters]


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
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
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes(volumes, word_counts)


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
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes(volumes, word_counts)


@router.post("/serials/{serial_id}/volumes/add", response_model=VolumeResponse, status_code=201)
async def add_single_volume_endpoint(
    serial_id: int, body: SingleVolumeCreate, session: AsyncSession = Depends(get_session)
):
    try:
        vol = await add_single_volume(session, serial_id, body)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes([vol], word_counts)[0]


@router.get("/serials/{serial_id}/volumes", response_model=list[VolumeResponse])
async def list_volumes_endpoint(serial_id: int, session: AsyncSession = Depends(get_session)):
    try:
        volumes = await list_volumes(session, serial_id)
    except SerialNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes(volumes, word_counts)


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
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes([vol], word_counts)[0]


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
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes([vol], word_counts)[0]


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        log.exception("Unexpected error generating volume %d for serial %d", volume_id, serial_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes([vol], word_counts)[0]


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
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes(volumes, word_counts)


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    word_counts = await get_volume_word_counts(session, serial_id)
    return _enrich_volumes([vol], word_counts)[0]
