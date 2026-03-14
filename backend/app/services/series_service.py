"""Series and reading order management."""

from __future__ import annotations

from sqlalchemy import func, nullslast, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.models.book import Book
from app.models.series import BookSeries, ReadingOrder, ReadingOrderEntry, Series
from app.schemas.series import (
    BookSeriesEntry,
    ReadingOrderCreate,
    ReadingOrderEntryCreate,
    SeriesCreate,
    SeriesUpdate,
)


class SeriesNotFound(Exception):
    pass


class BookNotFound(Exception):
    pass


class ReadingOrderNotFound(Exception):
    pass


# ── series ────────────────────────────────────────────────────────────────────


async def list_series(session: AsyncSession) -> list[Series]:
    result = await session.execute(select(Series).order_by(Series.parent_id, Series.sort_order))
    return result.scalars().all()  # type: ignore[return-value]


async def get_series(session: AsyncSession, series_id: int) -> Series:
    result = await session.execute(
        select(Series)
        .where(Series.id == series_id)
        .options(selectinload(Series.children), selectinload(Series.book_entries))
    )
    series = result.scalar_one_or_none()
    if series is None:
        raise SeriesNotFound(f"Series {series_id} not found")
    return series


async def create_series(session: AsyncSession, data: SeriesCreate) -> Series:
    if data.parent_id is not None:
        await get_series(session, data.parent_id)  # validate parent exists
    series = Series(
        name=data.name,
        parent_id=data.parent_id,
        description=data.description,
        sort_order=data.sort_order,
    )
    session.add(series)
    await session.commit()
    await session.refresh(series)
    return series


async def update_series(session: AsyncSession, series_id: int, data: SeriesUpdate) -> Series:
    series = await get_series(session, series_id)
    if data.name is not None:
        series.name = data.name
    if data.parent_id is not None:
        await get_series(session, data.parent_id)
        series.parent_id = data.parent_id
    if data.description is not None:
        series.description = data.description
    if data.sort_order is not None:
        series.sort_order = data.sort_order
    await session.commit()
    await session.refresh(series)
    return series


async def delete_series(session: AsyncSession, series_id: int) -> None:
    series = await get_series(session, series_id)
    await session.delete(series)
    await session.commit()


async def add_book_to_series(
    session: AsyncSession, series_id: int, data: BookSeriesEntry
) -> BookSeries:
    await get_series(session, series_id)
    book_result = await session.execute(select(Book).where(Book.id == data.series_id))  # noqa: reusing field name
    # Actually series_id in BookSeriesEntry is wrong — it's book_id
    # BookSeriesEntry has no book_id field, let's handle via separate param
    raise NotImplementedError("use add_book_to_series_by_id")


async def add_book_to_series_by_id(
    session: AsyncSession, series_id: int, book_id: str, sequence: float | None
) -> BookSeries:
    await get_series(session, series_id)
    book_result = await session.execute(select(Book).where(Book.id == book_id))
    if book_result.scalar_one_or_none() is None:
        raise BookNotFound(f"Book {book_id} not found")

    # Upsert
    existing = await session.execute(
        select(BookSeries).where(BookSeries.book_id == book_id, BookSeries.series_id == series_id)
    )
    bs = existing.scalar_one_or_none()
    if bs is None:
        bs = BookSeries(book_id=book_id, series_id=series_id, sequence=sequence)
        session.add(bs)
    else:
        bs.sequence = sequence
    await session.commit()
    return bs


async def remove_book_from_series(session: AsyncSession, series_id: int, book_id: str) -> None:
    result = await session.execute(
        select(BookSeries).where(BookSeries.book_id == book_id, BookSeries.series_id == series_id)
    )
    bs = result.scalar_one_or_none()
    if bs is not None:
        await session.delete(bs)
        await session.commit()


async def get_series_tree(session: AsyncSession) -> list[dict]:
    """Return all series as a flat list, clients can build the tree."""
    result = await session.execute(
        select(Series, func.count(BookSeries.book_id).label("book_count"))
        .outerjoin(BookSeries, Series.id == BookSeries.series_id)
        .group_by(Series.id)
        .order_by(Series.parent_id, Series.sort_order)
    )
    return [{"series": row.Series, "book_count": row.book_count} for row in result]


async def purge_empty_series(session: AsyncSession) -> list[str]:
    """
    Delete all series that have no books and no child series.
    Runs in repeated passes until nothing is left to delete, so that
    removing a child (e.g. Stormlight Archive) can cascade up to an
    empty parent (e.g. Cosmere) in the next pass.
    Returns the names of every series that was deleted.
    """
    deleted: list[str] = []
    while True:
        # Series with at least one book
        has_books = select(BookSeries.series_id).distinct()
        # Series with at least one child
        has_children = select(Series.parent_id).where(Series.parent_id.isnot(None)).distinct()

        result = await session.execute(
            select(Series).where(
                Series.id.not_in(has_books),
                Series.id.not_in(has_children),
            )
        )
        empty = result.scalars().all()
        if not empty:
            break
        for s in empty:
            deleted.append(s.name)
            await session.delete(s)
        await session.commit()
    return deleted


# ── reading orders ────────────────────────────────────────────────────────────


async def _collect_books_in_tree(session: AsyncSession, series_id: int) -> list[str]:
    """Return all book_ids reachable from this series (depth-first, ordered by sequence).

    Direct books come first (sorted by sequence), then each child sub-series
    (sorted by sort_order / name) recursively.  Deduplication happens in the caller.
    """
    direct = (
        await session.execute(
            select(BookSeries)
            .where(BookSeries.series_id == series_id)
            .order_by(nullslast(BookSeries.sequence), BookSeries.book_id)
        )
    ).scalars().all()
    book_ids: list[str] = [bs.book_id for bs in direct]

    children = (
        await session.execute(
            select(Series)
            .where(Series.parent_id == series_id)
            .order_by(Series.sort_order, Series.name)
        )
    ).scalars().all()
    for child in children:
        book_ids.extend(await _collect_books_in_tree(session, child.id))

    return book_ids


async def create_reading_order(session: AsyncSession, data: ReadingOrderCreate) -> ReadingOrder:
    await get_series(session, data.series_id)
    ro = ReadingOrder(name=data.name, series_id=data.series_id)
    session.add(ro)
    await session.flush()  # assign ro.id so entries can reference it

    # Pre-populate with all books reachable from the series tree, ordered
    # depth-first (direct books first, then each child sub-series in order).
    raw_ids = await _collect_books_in_tree(session, data.series_id)
    # Deduplicate while preserving first-seen order
    seen: set[str] = set()
    unique_ids: list[str] = []
    for bid in raw_ids:
        if bid not in seen:
            seen.add(bid)
            unique_ids.append(bid)

    for position, book_id in enumerate(unique_ids, start=1):
        session.add(
            ReadingOrderEntry(
                reading_order_id=ro.id,
                book_id=book_id,
                position=position,
            )
        )

    await session.commit()
    await session.refresh(ro, attribute_names=["entries"])
    return ro


async def get_reading_order(session: AsyncSession, order_id: int) -> ReadingOrder:
    result = await session.execute(
        select(ReadingOrder)
        .where(ReadingOrder.id == order_id)
        .options(selectinload(ReadingOrder.entries).joinedload(ReadingOrderEntry.book))
    )
    ro = result.scalar_one_or_none()
    if ro is None:
        raise ReadingOrderNotFound(f"Reading order {order_id} not found")
    return ro


async def delete_reading_order(session: AsyncSession, order_id: int) -> None:
    ro = await get_reading_order(session, order_id)
    await session.delete(ro)
    await session.commit()


async def add_reading_order_entry(
    session: AsyncSession, order_id: int, data: ReadingOrderEntryCreate
) -> ReadingOrderEntry:
    await get_reading_order(session, order_id)
    book_result = await session.execute(select(Book).where(Book.id == data.book_id))
    if book_result.scalar_one_or_none() is None:
        raise BookNotFound(f"Book {data.book_id} not found")
    entry = ReadingOrderEntry(
        reading_order_id=order_id,
        book_id=data.book_id,
        position=data.position,
        note=data.note,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


async def list_reading_orders_for_series(
    session: AsyncSession, series_id: int
) -> list[ReadingOrder]:
    await get_series(session, series_id)  # raises SeriesNotFound if missing
    result = await session.execute(
        select(ReadingOrder)
        .where(ReadingOrder.series_id == series_id)
        .options(selectinload(ReadingOrder.entries).joinedload(ReadingOrderEntry.book))
        .order_by(ReadingOrder.name)
    )
    return result.scalars().all()  # type: ignore[return-value]


async def list_books_in_series(session: AsyncSession, series_id: int) -> list[dict]:
    await get_series(session, series_id)  # raises SeriesNotFound if missing
    from sqlalchemy import nullsfirst

    result = await session.execute(
        select(BookSeries, Book)
        .join(Book, Book.id == BookSeries.book_id)
        .where(BookSeries.series_id == series_id)
        .order_by(nullsfirst(BookSeries.sequence), Book.title)
    )
    return [
        {
            "book_id": bs.book_id,
            "sequence": bs.sequence,
            "title": book.title,
            "author": book.author,
            "format": book.format,
            "cover_path": book.cover_path,
        }
        for bs, book in result
    ]


async def reorder_entries(
    session: AsyncSession, order_id: int, entry_positions: list[tuple[int, int]]
) -> None:
    """Update positions for a list of (entry_id, new_position) pairs."""
    for entry_id, position in entry_positions:
        result = await session.execute(
            select(ReadingOrderEntry).where(
                ReadingOrderEntry.id == entry_id,
                ReadingOrderEntry.reading_order_id == order_id,
            )
        )
        entry = result.scalar_one_or_none()
        if entry is not None:
            entry.position = position
    await session.commit()
