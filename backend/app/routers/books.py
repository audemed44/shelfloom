import math
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.book import (
    BookListResponse,
    BookMoveRequest,
    BookResponse,
    BookSeriesMembership,
    BookUpdate,
    ManualBookCreate,
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


def _book_response(
    book: "Book",  # noqa: F821
    reading_progress: float | None = None,
    last_read: "datetime | None" = None,  # type: ignore[name-defined]  # noqa: F821
    series_id: int | None = None,
    series_name: str | None = None,
    series_sequence: float | None = None,
) -> BookResponse:
    """Build BookResponse from ORM object without triggering lazy relationship loads."""
    col_data = {
        attr.key: getattr(book, attr.key) for attr in sa_inspect(type(book)).mapper.column_attrs
    }
    col_data["reading_progress"] = reading_progress
    col_data["last_read"] = last_read
    col_data["series_id"] = series_id
    col_data["series_name"] = series_name
    col_data["series_sequence"] = series_sequence
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
    series_map: dict[str, tuple[int, str, float | None]] = {}
    if books:
        from app.models.reading import ReadingProgress
        from app.models.series import BookSeries, Series

        book_ids = [b.id for b in books]

        prog_rows = await session.execute(
            sa_select(ReadingProgress.book_id, func.max(ReadingProgress.progress))
            .where(ReadingProgress.book_id.in_(book_ids))
            .group_by(ReadingProgress.book_id)
        )
        progress_map = {row[0]: row[1] for row in prog_rows.all()}

        series_rows = await session.execute(
            sa_select(BookSeries.book_id, Series.id, Series.name, BookSeries.sequence)
            .join(Series, BookSeries.series_id == Series.id)
            .where(BookSeries.book_id.in_(book_ids))
        )
        for row in series_rows.all():
            series_map[row[0]] = (row[1], row[2], row[3])

    items = [
        _book_response(
            b,
            progress_map.get(b.id),
            series_id=series_map[b.id][0] if b.id in series_map else None,
            series_name=series_map[b.id][1] if b.id in series_map else None,
            series_sequence=series_map[b.id][2] if b.id in series_map else None,
        )
        for b in books
    ]

    return BookListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=max(1, math.ceil(total / per_page)),
    )


@router.post("/manual", status_code=status.HTTP_201_CREATED, response_model=BookResponse)
async def create_manual_book_endpoint(
    data: ManualBookCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a manual book entry (physical book or visual novel) without a file."""
    import uuid as _uuid

    from app.models.book import Book
    from app.services.shelf_service import ensure_manual_shelf

    shelf = await ensure_manual_shelf(session)
    book_id = str(_uuid.uuid4())
    book = Book(
        id=book_id,
        title=data.title,
        author=data.author,
        isbn=data.isbn,
        format=data.format,
        file_path=f"manual://{book_id}",
        shelf_id=shelf.id,
        publisher=data.publisher,
        language=data.language,
        description=data.description,
        page_count=data.page_count,
        date_published=data.date_published,
        genre=data.genre,
    )
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return _book_response(book)


@router.get("/genres", response_model=list[str])
async def list_genres_endpoint(session: AsyncSession = Depends(get_session)):
    """Return all distinct genre values across all books, split and deduplicated."""
    from app.models.book import Book

    rows = await session.execute(sa_select(Book.genre).where(Book.genre.isnot(None)))
    genres: set[str] = set()
    for (raw,) in rows.all():
        for part in raw.split(","):
            g = part.strip()
            if g:
                genres.add(g)
    return sorted(genres, key=str.lower)


@router.get("/{book_id}/series", response_model=list[BookSeriesMembership])
async def get_book_series_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return await get_book_series_memberships(session, book_id)


@router.get("/{book_id}", response_model=BookResponse)
async def get_book_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    from app.models.reading import ReadingProgress, ReadingSession

    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    prog_row = await session.execute(
        sa_select(func.max(ReadingProgress.progress)).where(ReadingProgress.book_id == book_id)
    )
    reading_progress = prog_row.scalar()

    last_read_row = await session.execute(
        sa_select(func.max(ReadingSession.start_time)).where(
            ReadingSession.book_id == book_id,
            ReadingSession.dismissed.is_(False),
        )
    )
    last_read = last_read_row.scalar()

    return _book_response(book, reading_progress=reading_progress, last_read=last_read)


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
    from app.config import get_settings
    from app.services.import_service import _process_file

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

    if book.file_path.startswith("manual://"):
        raise HTTPException(status_code=400, detail="Manual books have no downloadable file")

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

    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    if book.file_path.startswith("manual://"):
        raise HTTPException(
            status_code=400, detail="Manual books have no file to extract cover from"
        )

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
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    if book.file_path.startswith("manual://"):
        raise HTTPException(status_code=400, detail="Manual books cannot be moved between shelves")

    try:
        book = await move_book(session, book_id, data.shelf_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ShelfNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileOperationError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return _book_response(book)
