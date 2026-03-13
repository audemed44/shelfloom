from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.tag import TagCreate, TagResponse
from app.services.tag_service import (
    BookNotFound,
    TagConflict,
    TagNotFound,
    assign_tag,
    create_tag,
    delete_tag,
    list_tags,
    remove_tag,
)

router = APIRouter(tags=["tags"])


@router.get("/tags", response_model=list[TagResponse])
async def list_tags_endpoint(session: AsyncSession = Depends(get_session)):
    return await list_tags(session)


@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag_endpoint(data: TagCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await create_tag(session, data.name)
    except TagConflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag_endpoint(tag_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_tag(session, tag_id)
    except TagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/books/{book_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_tag_endpoint(
    book_id: str, tag_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        await assign_tag(session, book_id, tag_id)
    except BookNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except TagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/books/{book_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_tag_endpoint(
    book_id: str, tag_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        await remove_tag(session, book_id, tag_id)
    except TagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
