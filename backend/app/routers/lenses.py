import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.book import BookListResponse
from app.schemas.lens import LensCreate, LensFilterState, LensResponse, LensUpdate
from app.services.lens_service import (
    LensNotFound,
    create_lens,
    delete_lens,
    get_lens,
    get_lens_books,
    list_lenses,
    update_lens,
)

router = APIRouter(prefix="/lenses", tags=["lenses"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=LensResponse)
async def create_lens_endpoint(
    data: LensCreate,
    session: AsyncSession = Depends(get_session),
):
    lens = await create_lens(session, data.name, data.filter_state)
    return _lens_detail_response(lens, book_count=0, cover_book_id=None)


@router.get("", response_model=list[LensResponse])
async def list_lenses_endpoint(session: AsyncSession = Depends(get_session)):
    items = await list_lenses(session)
    return [
        LensResponse(
            id=item["id"],
            name=item["name"],
            filter_state=item["filter_state"],
            book_count=item["book_count"],
            cover_book_id=item["cover_book_id"],
            created_at=item["created_at"],
            updated_at=item["updated_at"],
        )
        for item in items
    ]


@router.get("/{lens_id}", response_model=LensResponse)
async def get_lens_endpoint(lens_id: int, session: AsyncSession = Depends(get_session)):
    try:
        lens = await get_lens(session, lens_id)
    except LensNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    import json

    fs = LensFilterState.model_validate(json.loads(lens.filter_state))
    from app.services.book_service import list_books
    from app.services.lens_service import _fs_to_kwargs

    kwargs = _fs_to_kwargs(fs)
    books, total = await list_books(session, per_page=1, **kwargs)
    return LensResponse(
        id=lens.id,
        name=lens.name,
        filter_state=fs,
        book_count=total,
        cover_book_id=books[0].id if books else None,
        created_at=lens.created_at,
        updated_at=lens.updated_at,
    )


@router.get("/{lens_id}/books", response_model=BookListResponse)
async def get_lens_books_endpoint(
    lens_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=200),
    sort: str = Query("created_at"),
    search: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    try:
        books, total = await get_lens_books(
            session, lens_id, page=page, per_page=per_page, sort=sort, search=search
        )
    except LensNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    from sqlalchemy import func
    from sqlalchemy import select as sa_select

    from app.models.reading import ReadingProgress
    from app.models.series import BookSeries, Series
    from app.routers.books import _book_response, _load_book_metadata

    progress_map: dict[str, float] = {}
    series_map: dict[str, tuple] = {}
    tags_map: dict[str, list] = {}
    genres_map: dict[str, list] = {}

    if books:
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
        pages=max(1, math.ceil(total / per_page)),
    )


@router.patch("/{lens_id}", response_model=LensResponse)
async def update_lens_endpoint(
    lens_id: int,
    data: LensUpdate,
    session: AsyncSession = Depends(get_session),
):
    try:
        lens = await update_lens(session, lens_id, name=data.name, filter_state=data.filter_state)
    except LensNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))

    import json

    fs = LensFilterState.model_validate(json.loads(lens.filter_state))
    from app.services.book_service import list_books
    from app.services.lens_service import _fs_to_kwargs

    kwargs = _fs_to_kwargs(fs)
    books, total = await list_books(session, per_page=1, **kwargs)
    return LensResponse(
        id=lens.id,
        name=lens.name,
        filter_state=fs,
        book_count=total,
        cover_book_id=books[0].id if books else None,
        created_at=lens.created_at,
        updated_at=lens.updated_at,
    )


@router.delete("/{lens_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lens_endpoint(lens_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_lens(session, lens_id)
    except LensNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


def _lens_detail_response(lens, book_count: int, cover_book_id: str | None) -> LensResponse:
    import json

    fs = LensFilterState.model_validate(json.loads(lens.filter_state))
    return LensResponse(
        id=lens.id,
        name=lens.name,
        filter_state=fs,
        book_count=book_count,
        cover_book_id=cover_book_id,
        created_at=lens.created_at,
        updated_at=lens.updated_at,
    )
