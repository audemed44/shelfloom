from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.book import Book

router = APIRouter(tags=["authors"])


class AuthorResponse(BaseModel):
    name: str


@router.get("/authors", response_model=list[AuthorResponse])
async def list_authors_endpoint(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(distinct(Book.author))
        .where(Book.author.isnot(None))
        .where(Book.author != "")
        .order_by(Book.author)
    )
    return [AuthorResponse(name=row[0]) for row in result.all()]
