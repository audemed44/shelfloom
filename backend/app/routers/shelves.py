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
    list_shelves,
    update_shelf,
)

router = APIRouter(prefix="/shelves", tags=["shelves"])


def _shelf_to_response(shelf, book_count: int) -> ShelfResponse:
    data = ShelfResponse.model_validate(shelf)
    data.book_count = book_count
    return data


@router.get("", response_model=list[ShelfResponse])
async def list_shelves_endpoint(session: AsyncSession = Depends(get_session)):
    rows = await list_shelves(session)
    return [_shelf_to_response(shelf, count) for shelf, count in rows]


@router.get("/{shelf_id}", response_model=ShelfResponse)
async def get_shelf_endpoint(shelf_id: int, session: AsyncSession = Depends(get_session)):
    try:
        shelf, count = await get_shelf(session, shelf_id)
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return _shelf_to_response(shelf, count)


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
    return _shelf_to_response(shelf, 0)


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
    # Re-fetch book count
    _, count = await get_shelf(session, shelf_id)
    return _shelf_to_response(shelf, count)


@router.delete("/{shelf_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shelf_endpoint(shelf_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_shelf(session, shelf_id)
    except ShelfNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ShelfHasBooks as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
