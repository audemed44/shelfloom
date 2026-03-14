import math
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, inspect as sa_inspect, select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.book import (
    BookListResponse,
    BookMoveRequest,
    BookResponse,
    BookSeriesMembership,
    BookUpdate,
)
from app.services.book_service import (
    BookNotFound,
    FileOperationError,
    ShelfNotFound,
    delete_book,
    get_book,
    get_book_series_memberships,
    list_books,
    move_book,
    refresh_book_cover,
    update_book,
    upload_book_cover,
)

router = APIRouter(prefix="/books", tags=["books"])


def _book_response(book: "Book", reading_progress: float | None = None) -> BookResponse:  # type: ignore[name-defined]  # noqa: F821
    """Build BookResponse from ORM object without triggering lazy relationship loads."""
    col_data = {
        attr.key: getattr(book, attr.key)
        for attr in sa_inspect(type(book)).mapper.column_attrs
    }
    col_data["reading_progress"] = reading_progress
    return BookResponse.model_validate(col_data)


@router.get("", response_model=BookListResponse)
async def list_books_endpoint(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    shelf_id: int | None = Query(None),
    format: str | None = Query(None),
    tag: str | None = Query(None),
    series_id: int | None = Query(None),
    status: str | None = Query(None),
    sort: str = Query("created_at"),
    session: AsyncSession = Depends(get_session),
):
    books, total = await list_books(
        session,
        page=page,
        per_page=per_page,
        search=search,
        shelf_id=shelf_id,
        format=format,
        tag=tag,
        series_id=series_id,
        status=status,
        sort=sort,
    )

    # Batch-fetch max reading progress per book (single query)
    progress_map: dict[str, float] = {}
    if books:
        from app.models.reading import ReadingProgress
        prog_rows = await session.execute(
            sa_select(ReadingProgress.book_id, func.max(ReadingProgress.progress))
            .where(ReadingProgress.book_id.in_([b.id for b in books]))
            .group_by(ReadingProgress.book_id)
        )
        progress_map = {row[0]: row[1] for row in prog_rows.all()}

    items = [_book_response(b, progress_map.get(b.id)) for b in books]

    return BookListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=max(1, math.ceil(total / per_page)),
    )


@router.get("/{book_id}/series", response_model=list[BookSeriesMembership])
async def get_book_series_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return await get_book_series_memberships(session, book_id)


@router.get("/{book_id}", response_model=BookResponse)
async def get_book_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _book_response(book)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=BookResponse)
async def upload_book_endpoint(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
):
    """Upload a book file and import it to the default shelf."""
    from sqlalchemy import select
    from app.models.shelf import Shelf

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".epub", ".pdf"):
        raise HTTPException(status_code=400, detail="Only .epub and .pdf files are supported")

    # Find default shelf
    result = await session.execute(select(Shelf).where(Shelf.is_default == True))  # noqa: E712
    shelf = result.scalar_one_or_none()
    if shelf is None:
        raise HTTPException(status_code=409, detail="No default shelf configured")

    # Save file to shelf
    dest = Path(shelf.path) / (file.filename or "upload" + suffix)
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    dest.write_bytes(content)

    # Import
    from app.services.import_service import _process_file
    from app.config import get_settings

    settings = get_settings()
    try:
        await _process_file(session, shelf, dest, settings.covers_dir)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Failed to import file: {e}")

    # Find the created book
    from sqlalchemy import select as _select
    from app.models.book import Book

    rel_path = str(dest.relative_to(shelf.path))
    result2 = await session.execute(
        _select(Book).where(Book.shelf_id == shelf.id, Book.file_path == rel_path)
    )
    book = result2.scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=500, detail="Book was imported but could not be found")
    return _book_response(book)


@router.patch("/{book_id}", response_model=BookResponse)
async def update_book_endpoint(
    book_id: str,
    data: BookUpdate,
    session: AsyncSession = Depends(get_session),
):
    try:
        book = await update_book(session, book_id, data)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _book_response(book)


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_book_endpoint(
    book_id: str,
    delete_file: bool = Query(False),
    session: AsyncSession = Depends(get_session),
):
    try:
        await delete_book(session, book_id, delete_file=delete_file)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{book_id}/cover")
async def get_cover_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not book.cover_path or not os.path.exists(book.cover_path):
        raise HTTPException(status_code=404, detail="No cover available")
    return FileResponse(book.cover_path, media_type="image/jpeg")


@router.get("/{book_id}/download")
async def download_book_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    from sqlalchemy import select
    from app.models.shelf import Shelf

    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
    shelf = shelf_result.scalar_one_or_none()
    if shelf is None:
        raise HTTPException(status_code=404, detail="Shelf not found")

    full_path = Path(shelf.path) / book.file_path
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    media_type = "application/epub+zip" if book.format == "epub" else "application/pdf"
    return FileResponse(str(full_path), media_type=media_type, filename=full_path.name)


@router.post("/{book_id}/refresh-cover", response_model=BookResponse)
async def refresh_cover_endpoint(
    book_id: str,
    session: AsyncSession = Depends(get_session),
):
    from app.config import get_settings

    settings = get_settings()
    try:
        book = await refresh_book_cover(session, book_id, settings.covers_dir)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (ShelfNotFound, FileOperationError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _book_response(book)


@router.post("/{book_id}/upload-cover", response_model=BookResponse)
async def upload_cover_endpoint(
    book_id: str,
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
):
    from app.config import get_settings

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    settings = get_settings()
    image_data = await file.read()
    try:
        book = await upload_book_cover(session, book_id, settings.covers_dir, image_data)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileOperationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _book_response(book)


@router.post("/{book_id}/move", response_model=BookResponse)
async def move_book_endpoint(
    book_id: str,
    data: BookMoveRequest,
    session: AsyncSession = Depends(get_session),
):
    try:
        book = await move_book(session, book_id, data.shelf_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ShelfNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileOperationError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return _book_response(book)
