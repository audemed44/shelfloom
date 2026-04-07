import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.book import (
    BookDetailResponse,
    BookListResponse,
    BookMoveRequest,
    BookResponse,
    BookSeriesMembership,
    BookUpdate,
    BulkBookActionResponse,
    BulkBookMetadataUpdate,
    BulkBookMoveRequest,
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
_BOOK_COVER_HEADERS = {"Cache-Control": "no-cache"}
_BOOK_COVER_IMMUTABLE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}


def _book_cover_success_headers(request: Request) -> dict[str, str]:
    if "cover" in request.query_params or "v" in request.query_params:
        return _BOOK_COVER_IMMUTABLE_HEADERS
    return _BOOK_COVER_HEADERS


def _compute_status(
    reading_progress: float | None,
    reading_state: str | None,
) -> str:
    if reading_state == "dnf":
        return "dnf"
    if reading_progress is not None and reading_progress >= 100:
        return "completed"
    if reading_progress is not None and reading_progress > 0:
        return "reading"
    return "unread"


def _book_response(
    book: "Book",  # noqa: F821
    reading_progress: float | None = None,
    last_read: "datetime | None" = None,  # type: ignore[name-defined]  # noqa: F821
    series_id: int | None = None,
    series_name: str | None = None,
    series_sequence: float | None = None,
    tags: list[dict] | None = None,
    genres: list[dict] | None = None,
    include_review: bool = False,
) -> BookResponse | BookDetailResponse:
    """Build BookResponse from ORM object without triggering lazy relationship loads."""
    col_data = {
        attr.key: getattr(book, attr.key) for attr in sa_inspect(type(book)).mapper.column_attrs
    }
    has_review = bool(book.review and book.review.strip())
    col_data["reading_progress"] = reading_progress
    col_data["last_read"] = last_read
    col_data["series_id"] = series_id
    col_data["series_name"] = series_name
    col_data["series_sequence"] = series_sequence
    col_data["status"] = _compute_status(reading_progress, book.reading_state)
    col_data["has_review"] = has_review
    col_data["tags"] = tags or []
    col_data["genres"] = genres or []
    if include_review:
        return BookDetailResponse.model_validate(col_data)
    col_data.pop("review", None)
    col_data.pop("review_updated_at", None)
    return BookResponse.model_validate(col_data)


async def _load_book_metadata(
    session: AsyncSession, book_ids: list[str]
) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    tags_map: dict[str, list[dict]] = {}
    genres_map: dict[str, list[dict]] = {}
    if not book_ids:
        return tags_map, genres_map

    from app.models.genre import BookGenre, Genre
    from app.models.tag import BookTag, Tag

    tag_rows = await session.execute(
        sa_select(BookTag.book_id, Tag.id, Tag.name)
        .join(Tag, BookTag.tag_id == Tag.id)
        .where(BookTag.book_id.in_(book_ids))
        .order_by(Tag.name)
    )
    for row in tag_rows.all():
        tags_map.setdefault(row[0], []).append({"id": row[1], "name": row[2]})

    genre_rows = await session.execute(
        sa_select(BookGenre.book_id, Genre.id, Genre.name)
        .join(Genre, BookGenre.genre_id == Genre.id)
        .where(BookGenre.book_id.in_(book_ids))
        .order_by(Genre.name)
    )
    for row in genre_rows.all():
        genres_map.setdefault(row[0], []).append({"id": row[1], "name": row[2]})

    return tags_map, genres_map


@router.get("", response_model=BookListResponse)
async def list_books_endpoint(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    shelf_id: int | None = Query(None),
    format: str | None = Query(None),
    tag: str | None = Query(None),
    genre: str | None = Query(None),
    author: str | None = Query(None),
    series_id: int | None = Query(None),
    status: str | None = Query(None),
    min_rating: float | None = Query(None, ge=0.5, le=5),
    has_rating: bool | None = Query(None),
    has_review: bool | None = Query(None),
    sort: str = Query("created_at"),
    filter_mode: str = Query("and"),
    group_by_series: bool = Query(False),
    session: AsyncSession = Depends(get_session),
):
    books, total, pages = await list_books(
        session,
        page=page,
        per_page=per_page,
        search=search,
        shelf_id=shelf_id,
        format=format,
        tag=tag,
        genre=genre,
        author=author,
        series_id=series_id,
        status=status,
        min_rating=min_rating,
        has_rating=has_rating,
        has_review=has_review,
        sort=sort,
        filter_mode=filter_mode,
        group_by_series=group_by_series,
    )

    # Batch-fetch max reading progress per book (single query)
    progress_map: dict[str, float] = {}
    series_map: dict[str, tuple[int, str, float | None]] = {}
    tags_map: dict[str, list[dict]] = {}
    genres_map: dict[str, list[dict]] = {}
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

        tags_map, genres_map = await _load_book_metadata(session, book_ids)

    items = [
        _book_response(
            b,
            progress_map.get(b.id),
            series_id=series_map[b.id][0] if b.id in series_map else None,
            series_name=series_map[b.id][1] if b.id in series_map else None,
            series_sequence=series_map[b.id][2] if b.id in series_map else None,
            tags=tags_map.get(b.id, []),
            genres=genres_map.get(b.id, []),
        )
        for b in books
    ]

    return BookListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
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
    )
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return _book_response(book)


# ---------------------------------------------------------------------------
# Bulk actions
# ---------------------------------------------------------------------------


@router.post("/bulk-metadata", response_model=BulkBookActionResponse)
async def bulk_metadata_endpoint(
    data: BulkBookMetadataUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Add/remove tags and genres across multiple books."""
    from app.services.bulk_book_service import bulk_update_metadata

    results = await bulk_update_metadata(
        session,
        data.book_ids,
        add_tag_ids=data.add_tag_ids,
        remove_tag_ids=data.remove_tag_ids,
        add_genre_ids=data.add_genre_ids,
        remove_genre_ids=data.remove_genre_ids,
    )
    succeeded = sum(1 for r in results if r["success"])
    return BulkBookActionResponse(
        results=results,
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
    )


@router.post("/bulk-move", response_model=BulkBookActionResponse)
async def bulk_move_endpoint(
    data: BulkBookMoveRequest,
    session: AsyncSession = Depends(get_session),
):
    """Move multiple books to a different shelf."""
    from app.services.bulk_book_service import bulk_move_books

    results = await bulk_move_books(session, data.book_ids, data.target_shelf_id)
    succeeded = sum(1 for r in results if r["success"])
    return BulkBookActionResponse(
        results=results,
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
    )


@router.get("/{book_id}/series", response_model=list[BookSeriesMembership])
async def get_book_series_endpoint(book_id: str, session: AsyncSession = Depends(get_session)):
    try:
        await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return await get_book_series_memberships(session, book_id)


@router.get("/{book_id}", response_model=BookDetailResponse)
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

    tags_map, genres_map = await _load_book_metadata(session, [book_id])

    return _book_response(
        book,
        reading_progress=reading_progress,
        last_read=last_read,
        tags=tags_map.get(book_id, []),
        genres=genres_map.get(book_id, []),
        include_review=True,
    )


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
    tags_map, genres_map = await _load_book_metadata(session, [book.id])
    return _book_response(book, tags=tags_map.get(book.id, []), genres=genres_map.get(book.id, []))


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
    tags_map, genres_map = await _load_book_metadata(session, [book.id])
    return _book_response(book, tags=tags_map.get(book.id, []), genres=genres_map.get(book.id, []))


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
async def get_cover_endpoint(
    book_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    try:
        book = await get_book(session, book_id)
    except BookNotFound as e:
        raise HTTPException(status_code=404, detail=str(e), headers=_BOOK_COVER_HEADERS)
    if not book.cover_path or not os.path.exists(book.cover_path):
        raise HTTPException(
            status_code=404,
            detail="No cover available",
            headers=_BOOK_COVER_HEADERS,
        )
    return FileResponse(
        book.cover_path,
        media_type="image/jpeg",
        headers=_book_cover_success_headers(request),
    )


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
    tags_map, genres_map = await _load_book_metadata(session, [book.id])
    return _book_response(book, tags=tags_map.get(book.id, []), genres=genres_map.get(book.id, []))


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
    tags_map, genres_map = await _load_book_metadata(session, [book.id])
    return _book_response(book, tags=tags_map.get(book.id, []), genres=genres_map.get(book.id, []))


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
    tags_map, genres_map = await _load_book_metadata(session, [book.id])
    return _book_response(book, tags=tags_map.get(book.id, []), genres=genres_map.get(book.id, []))
