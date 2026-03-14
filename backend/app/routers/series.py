from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.series import (
    AddBookToSeriesBody,
    ReadingOrderCreate,
    ReadingOrderDetailResponse,
    ReadingOrderEntryCreate,
    ReadingOrderEntryResponse,
    ReadingOrderResponse,
    SeriesBookItem,
    SeriesCreate,
    SeriesResponse,
    SeriesUpdate,
)
from app.services.series_service import (
    BookNotFound,
    ReadingOrderNotFound,
    SeriesNotFound,
    add_book_to_series_by_id,
    add_reading_order_entry,
    create_reading_order,
    create_series,
    delete_reading_order,
    delete_series,
    get_reading_order,
    get_series,
    get_series_tree,
    list_books_in_series,
    list_reading_orders_for_series,
    list_series,
    purge_empty_series,
    remove_book_from_series,
    reorder_entries,
    update_series,
)

router = APIRouter(tags=["series"])


# ── series ────────────────────────────────────────────────────────────────────


@router.get("/series", response_model=list[SeriesResponse])
async def list_series_endpoint(session: AsyncSession = Depends(get_session)):
    items = await list_series(session)
    return [SeriesResponse.model_validate(s) for s in items]


@router.get("/series/tree")
async def series_tree_endpoint(session: AsyncSession = Depends(get_session)):
    rows = await get_series_tree(session)
    result = []
    for row in rows:
        data = SeriesResponse.model_validate(row["series"]).model_dump()
        data["book_count"] = row["book_count"]
        data["first_book_id"] = row["first_book_id"]
        data["parent_name"] = row["parent_name"]
        result.append(data)
    return result


@router.delete("/series/empty", status_code=status.HTTP_200_OK)
async def purge_empty_series_endpoint(session: AsyncSession = Depends(get_session)):
    """Delete all series with no books and no children, cascading up to empty parents."""
    deleted = await purge_empty_series(session)
    return {"deleted": deleted, "count": len(deleted)}


@router.get("/series/{series_id}", response_model=SeriesResponse)
async def get_series_endpoint(series_id: int, session: AsyncSession = Depends(get_session)):
    try:
        series = await get_series(session, series_id)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SeriesResponse.model_validate(series)


@router.post("/series", response_model=SeriesResponse, status_code=status.HTTP_201_CREATED)
async def create_series_endpoint(data: SeriesCreate, session: AsyncSession = Depends(get_session)):
    try:
        series = await create_series(session, data)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SeriesResponse.model_validate(series)


@router.patch("/series/{series_id}", response_model=SeriesResponse)
async def update_series_endpoint(
    series_id: int, data: SeriesUpdate, session: AsyncSession = Depends(get_session)
):
    try:
        series = await update_series(session, series_id, data)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SeriesResponse.model_validate(series)


@router.delete("/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series_endpoint(series_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await delete_series(session, series_id)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/series/{series_id}/books/{book_id}", status_code=status.HTTP_201_CREATED)
async def add_book_endpoint(
    series_id: int,
    book_id: str,
    sequence: float | None = None,
    body: AddBookToSeriesBody | None = None,
    session: AsyncSession = Depends(get_session),
):
    # Body takes precedence over query param when provided
    if body is not None and body.sequence is not None:
        sequence = body.sequence
    try:
        bs = await add_book_to_series_by_id(session, series_id, book_id, sequence)
    except (SeriesNotFound, BookNotFound) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"series_id": bs.series_id, "book_id": bs.book_id, "sequence": bs.sequence}


@router.delete("/series/{series_id}/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_book_endpoint(
    series_id: int, book_id: str, session: AsyncSession = Depends(get_session)
):
    await remove_book_from_series(session, series_id, book_id)


@router.get(
    "/series/{series_id}/reading-orders",
    response_model=list[ReadingOrderDetailResponse],
)
async def list_series_reading_orders_endpoint(
    series_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        orders = await list_reading_orders_for_series(session, series_id)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [ReadingOrderDetailResponse.model_validate(ro) for ro in orders]


@router.get("/series/{series_id}/books", response_model=list[SeriesBookItem])
async def list_series_books_endpoint(series_id: int, session: AsyncSession = Depends(get_session)):
    try:
        books = await list_books_in_series(session, series_id)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [SeriesBookItem(**b) for b in books]


# ── reading orders ────────────────────────────────────────────────────────────


@router.post(
    "/reading-orders",
    response_model=ReadingOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reading_order_endpoint(
    data: ReadingOrderCreate, session: AsyncSession = Depends(get_session)
):
    try:
        ro = await create_reading_order(session, data)
    except SeriesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ReadingOrderResponse.model_validate(ro)


@router.get("/reading-orders/{order_id}", response_model=ReadingOrderDetailResponse)
async def get_reading_order_endpoint(order_id: int, session: AsyncSession = Depends(get_session)):
    try:
        ro = await get_reading_order(session, order_id)
    except ReadingOrderNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ReadingOrderDetailResponse.model_validate(ro)


@router.delete("/reading-orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reading_order_endpoint(
    order_id: int, session: AsyncSession = Depends(get_session)
):
    try:
        await delete_reading_order(session, order_id)
    except ReadingOrderNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/reading-orders/{order_id}/entries",
    response_model=ReadingOrderEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_entry_endpoint(
    order_id: int,
    data: ReadingOrderEntryCreate,
    session: AsyncSession = Depends(get_session),
):
    try:
        entry = await add_reading_order_entry(session, order_id, data)
    except (ReadingOrderNotFound, BookNotFound) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ReadingOrderEntryResponse.model_validate(entry)


@router.patch("/reading-orders/{order_id}/entries/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_entries_endpoint(
    order_id: int,
    entries: list[dict],
    session: AsyncSession = Depends(get_session),
):
    """Body: [{"id": 1, "position": 1}, ...]"""
    pairs = [(e["id"], e["position"]) for e in entries]
    await reorder_entries(session, order_id, pairs)
