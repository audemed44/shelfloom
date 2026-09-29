"""Foyer dashboard widget (see app.services.foyer_widget for the format)."""

from fastapi import APIRouter, Depends, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.routers.books import upload_book_endpoint
from app.services.foyer_widget import build_widget

router = APIRouter(prefix="/foyer", tags=["foyer"])


@router.get("/widget")
async def widget(session: AsyncSession = Depends(get_session)) -> dict:
    """Reading summary for a Foyer dashboard card."""
    return await build_widget(session)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload(file: UploadFile, session: AsyncSession = Depends(get_session)) -> dict:
    """Add a book sent from Foyer's Drop inbox to the default shelf.

    Imports like ``POST /api/books`` and answers in the shape Foyer shows:
    a message and a link to the new book (relative to the public address).
    """
    book = await upload_book_endpoint(file, session)
    message = f"Added “{book.title}”"
    if book.author:
        message += f" by {book.author}"
    return {"message": message, "url": f"/books/{book.id}"}
