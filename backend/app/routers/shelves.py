from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.shelf import ShelfCreate, ShelfResponse, ShelfUpdate
from app.services.shelf_service import (
    PathNotFound,
    ShelfConflict,
    ShelfHasBooks,
    ShelfNotFound,
    create_shelf,
    delete_shelf,
    get_shelf,
    get_shelf_templates,
    list_shelves,
    update_shelf,
)

router = APIRouter(prefix="/shelves", tags=["shelves"])


def _shelf_to_response(shelf, book_count: int, tmpl=None) -> ShelfResponse:
    return ShelfResponse(
        id=shelf.id,
        name=shelf.name,
        path=shelf.path,
        is_default=shelf.is_default,
        is_sync_target=shelf.is_sync_target,
        device_name=shelf.device_name,
        koreader_stats_db_path=shelf.koreader_stats_db_path,
        auto_organize=shelf.auto_organize,
        created_at=shelf.created_at,
        book_count=book_count,
        organize_template=tmpl.template if tmpl else None,
        seq_pad=tmpl.seq_pad if tmpl else 2,
    )


@router.get("", response_model=list[ShelfResponse])
async def list_shelves_endpoint(session: AsyncSession = Depends(get_session)):
    rows = await list_shelves(session)
    tmpl_map = await get_shelf_templates(session, [shelf.id for shelf, _ in rows])
    return [_shelf_to_response(shelf, count, tmpl_map.get(shelf.id)) for shelf, count in rows]


@router.get("/{shelf_id}", response_model=ShelfResponse)
async def get_shelf_endpoint(shelf_id: int, session: AsyncSession = Depends(get_session)):
    try:
        shelf, count = await get_shelf(session, shelf_id)
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    tmpl_map = await get_shelf_templates(session, [shelf_id])
    return _shelf_to_response(shelf, count, tmpl_map.get(shelf_id))


@router.post("", response_model=ShelfResponse, status_code=status.HTTP_201_CREATED)
async def create_shelf_endpoint(
    data: ShelfCreate, session: AsyncSession = Depends(get_session)
):
    try:
        shelf = await create_shelf(session, data)
    except PathNotFound as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ShelfConflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    tmpl_map = await get_shelf_templates(session, [shelf.id])
    return _shelf_to_response(shelf, 0, tmpl_map.get(shelf.id))


@router.patch("/{shelf_id}", response_model=ShelfResponse)
async def update_shelf_endpoint(
    shelf_id: int, data: ShelfUpdate, session: AsyncSession = Depends(get_session)
):
    try:
        shelf = await update_shelf(session, shelf_id, data)
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ShelfConflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    # Re-fetch book count and template
    _, count = await get_shelf(session, shelf_id)
    tmpl_map = await get_shelf_templates(session, [shelf_id])
    return _shelf_to_response(shelf, count, tmpl_map.get(shelf_id))


@router.delete("/{shelf_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shelf_endpoint(shelf_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_shelf(session, shelf_id)
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ShelfHasBooks as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
