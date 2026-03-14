"""Tests for all ORM models — instantiation, relationships, constraints."""
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.book import Book, BookHash
from app.models.reading import Highlight, ReadingProgress, ReadingSession
from app.models.series import BookSeries, ReadingOrder, ReadingOrderEntry, Series
from app.models.shelf import Shelf, ShelfTemplate
from app.models.tag import BookTag, Tag


# ── helpers ──────────────────────────────────────────────────────────────────

def make_shelf(name: str = "Library", path: str = "/shelves/lib", is_default: bool = False) -> Shelf:
    return Shelf(name=name, path=path, is_default=is_default)


def make_book(shelf_id: int, title: str = "Test Book", fmt: str = "epub") -> Book:
    return Book(
        id=str(uuid.uuid4()),
        title=title,
        format=fmt,
        file_path=f"{title}.{fmt}",
        shelf_id=shelf_id,
    )


# ── shelf ─────────────────────────────────────────────────────────────────────

async def test_shelf_create(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    assert shelf.id is not None
    assert shelf.is_default is False
    assert shelf.is_sync_target is False


async def test_shelf_name_unique(db_session):
    db_session.add(make_shelf("Dups"))
    db_session.add(make_shelf("Dups"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_shelf_template(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    tmpl = ShelfTemplate(shelf_id=shelf.id, template="{author}/{title}")
    db_session.add(tmpl)
    await db_session.commit()
    await db_session.refresh(shelf)
    assert shelf.template is not None
    assert shelf.template.template == "{author}/{title}"
    assert shelf.template.seq_pad == 2


async def test_shelf_template_cascade_delete(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    tmpl = ShelfTemplate(shelf_id=shelf.id, template="{title}")
    db_session.add(tmpl)
    await db_session.commit()

    await db_session.delete(shelf)
    await db_session.commit()
    result = await db_session.execute(select(ShelfTemplate))
    assert result.scalars().all() == []


# ── book ──────────────────────────────────────────────────────────────────────

async def test_book_create(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    assert book.id is not None
    assert book.shelf_id == shelf.id


async def test_book_shelf_relationship(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.shelf))
    )
    loaded = result.scalar_one()
    assert loaded.shelf.name == "Library"


async def test_book_hash(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    bh = BookHash(book_id=book.id, hash_sha="abc123", hash_md5="def456")
    db_session.add(bh)
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.hashes))
    )
    loaded = result.scalar_one()
    assert len(loaded.hashes) == 1
    assert loaded.hashes[0].hash_sha == "abc123"


async def test_book_hashes_cascade_on_book_delete(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    db_session.add(BookHash(book_id=book.id, hash_sha="aaa", hash_md5="bbb"))
    await db_session.commit()

    await db_session.delete(book)
    await db_session.commit()
    result = await db_session.execute(select(BookHash))
    assert result.scalars().all() == []


async def test_cannot_delete_shelf_with_books(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    db_session.add(make_book(shelf.id))
    await db_session.commit()

    with pytest.raises(IntegrityError):
        await db_session.delete(shelf)
        await db_session.commit()


# ── series ────────────────────────────────────────────────────────────────────

async def test_series_create_top_level(db_session):
    s = Series(name="Cosmere")
    db_session.add(s)
    await db_session.commit()
    assert s.id is not None
    assert s.parent_id is None


async def test_series_parent_child(db_session):
    parent = Series(name="Cosmere")
    db_session.add(parent)
    await db_session.flush()
    child = Series(name="Stormlight Archive", parent_id=parent.id)
    db_session.add(child)
    await db_session.commit()
    result = await db_session.execute(
        select(Series).where(Series.id == parent.id).options(selectinload(Series.children))
    )
    loaded = result.scalar_one()
    assert len(loaded.children) == 1
    assert loaded.children[0].name == "Stormlight Archive"


async def test_book_series_join(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    series = Series(name="The Way of Kings")
    db_session.add(series)
    await db_session.flush()
    bs = BookSeries(book_id=book.id, series_id=series.id, sequence=1.0)
    db_session.add(bs)
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.series_entries))
    )
    loaded = result.scalar_one()
    assert len(loaded.series_entries) == 1
    assert loaded.series_entries[0].sequence == 1.0


async def test_book_series_fractional_sequence(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    series = Series(name="Mistborn")
    db_session.add(series)
    await db_session.flush()
    bs = BookSeries(book_id=book.id, series_id=series.id, sequence=2.5)
    db_session.add(bs)
    await db_session.commit()
    await db_session.refresh(bs)
    assert bs.sequence == 2.5


async def test_delete_series_unlinks_books(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    series = Series(name="Temp")
    db_session.add(series)
    await db_session.flush()
    db_session.add(BookSeries(book_id=book.id, series_id=series.id, sequence=1))
    await db_session.commit()

    await db_session.delete(series)
    await db_session.commit()

    # Book still exists, join row gone
    result = await db_session.execute(select(Book).where(Book.id == book.id))
    assert result.scalar_one_or_none() is not None
    result2 = await db_session.execute(select(BookSeries))
    assert result2.scalars().all() == []


async def test_reading_order(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    series = Series(name="Cosmere")
    db_session.add(series)
    await db_session.flush()
    ro = ReadingOrder(name="Publication Order", series_id=series.id)
    db_session.add(ro)
    await db_session.flush()
    entry = ReadingOrderEntry(reading_order_id=ro.id, book_id=book.id, position=1)
    db_session.add(entry)
    await db_session.commit()
    result = await db_session.execute(
        select(ReadingOrder).where(ReadingOrder.id == ro.id)
        .options(selectinload(ReadingOrder.entries))
    )
    loaded = result.scalar_one()
    assert len(loaded.entries) == 1


async def test_delete_reading_order_removes_entries(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    series = Series(name="S")
    db_session.add(series)
    await db_session.flush()
    ro = ReadingOrder(name="R", series_id=series.id)
    db_session.add(ro)
    await db_session.flush()
    db_session.add(ReadingOrderEntry(reading_order_id=ro.id, book_id=book.id, position=1))
    await db_session.commit()

    await db_session.delete(ro)
    await db_session.commit()

    result = await db_session.execute(select(ReadingOrderEntry))
    assert result.scalars().all() == []
    # book still exists
    result2 = await db_session.execute(select(Book).where(Book.id == book.id))
    assert result2.scalar_one_or_none() is not None


# ── tags ──────────────────────────────────────────────────────────────────────

async def test_tag_unique(db_session):
    db_session.add(Tag(name="sci-fi"))
    db_session.add(Tag(name="sci-fi"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_book_tag(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    tag = Tag(name="fantasy")
    db_session.add(tag)
    await db_session.flush()
    db_session.add(BookTag(book_id=book.id, tag_id=tag.id))
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.tags))
    )
    loaded = result.scalar_one()
    assert len(loaded.tags) == 1


# ── reading progress / sessions / highlights ──────────────────────────────────

async def test_reading_progress(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    rp = ReadingProgress(book_id=book.id, progress=0.42, device="Kobo")
    db_session.add(rp)
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.reading_progress))
    )
    loaded = result.scalar_one()
    assert len(loaded.reading_progress) == 1
    assert loaded.reading_progress[0].progress == pytest.approx(0.42)


async def test_reading_session_source_key_unique(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    db_session.add(ReadingSession(book_id=book.id, source="sdr", source_key="key1"))
    db_session.add(ReadingSession(book_id=book.id, source="sdr", source_key="key1"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_reading_session_dismissed_default_false(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    rs = ReadingSession(book_id=book.id, source="manual")
    db_session.add(rs)
    await db_session.commit()
    await db_session.refresh(rs)
    assert rs.dismissed is False


async def test_highlight(db_session):
    shelf = make_shelf()
    db_session.add(shelf)
    await db_session.flush()
    book = make_book(shelf.id)
    db_session.add(book)
    await db_session.flush()
    h = Highlight(book_id=book.id, text="Great passage", chapter="Chapter 1")
    db_session.add(h)
    await db_session.commit()
    result = await db_session.execute(
        select(Book).where(Book.id == book.id).options(selectinload(Book.highlights))
    )
    loaded = result.scalar_one()
    assert len(loaded.highlights) == 1
    assert loaded.highlights[0].text == "Great passage"
