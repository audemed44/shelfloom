from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.genre import GenreCreate, GenreResponse
from app.services.genre_service import (
    BookNotFound,
    GenreConflict,
    GenreNotFound,
    assign_genre,
    create_genre,
    delete_genre,
    list_genres,
    remove_genre,
)

router = APIRouter(tags=["genres"])


@router.get("/genres", response_model=list[GenreResponse])
async def list_genres_endpoint(session: AsyncSession = Depends(get_session)):
    return await list_genres(session)


@router.post("/genres", response_model=GenreResponse, status_code=status.HTTP_201_CREATED)
async def create_genre_endpoint(data: GenreCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await create_genre(session, data.name)
    except GenreConflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.delete("/genres/{genre_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_genre_endpoint(genre_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_genre(session, genre_id)
    except GenreNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/books/{book_id}/genres/{genre_id}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_genre_endpoint(
    book_id: str, genre_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        await assign_genre(session, book_id, genre_id)
    except BookNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except GenreNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/books/{book_id}/genres/{genre_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_genre_endpoint(
    book_id: str, genre_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        await remove_genre(session, book_id, genre_id)
    except GenreNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
