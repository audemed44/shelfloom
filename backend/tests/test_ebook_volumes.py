"""Tests for linking existing ebooks to a web serial as volumes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf


async def _seed(db_session, tmp_path: Path, *, generated: int = 0):
    """A serial whose first 6 chapters are stubbed, plus 2 purchased ebooks.

    ``generated`` volumes (unnamed, already built) cover chapters 7+.
    """
    shelf = Shelf(name="Library", path=str(tmp_path))
    series = Series(name="Serial")
    db_session.add_all([shelf, series])
    await db_session.flush()

    serial = WebSerial(
        url="https://www.royalroad.com/fiction/1/s",
        source="royalroad",
        title="Serial",
        status="ongoing",
        total_chapters=10,
        live_chapter_count=4,
        series_id=series.id,
    )
    db_session.add(serial)
    await db_session.flush()
    for n in range(1, 11):
        db_session.add(
            SerialChapter(
                serial_id=serial.id,
                chapter_number=n,
                source_key=f"k{n}",
                source_url=f"https://www.royalroad.com/ch/{n}",
                title=f"Chapter {n}",
                is_stubbed=n <= 6,
                content=None if n <= 6 else "<p>x</p>",
                word_count=None if n <= 6 else 1000,
            )
        )

    ebooks = []
    for i in (1, 2):
        path = tmp_path / f"book{i}.epub"
        path.write_bytes(b"purchased ebook")
        book = Book(
            id=str(uuid.uuid4()),
            title=f"Serial Book {i}",
            author="Author",
            format="epub",
            file_path=path.name,
            shelf_id=shelf.id,
        )
        db_session.add(book)
        ebooks.append(book)
    await db_session.flush()

    for v in range(generated):
        gen_book = Book(
            id=str(uuid.uuid4()),
            title=f"Serial - Volume {v + 1}",
            format="epub",
            file_path=f"gen{v + 1}.epub",
            shelf_id=shelf.id,
        )
        db_session.add(gen_book)
        await db_session.flush()
        db_session.add(
            SerialVolume(
                serial_id=serial.id,
                volume_number=v + 1,
                kind="generated",
                book_id=gen_book.id,
                chapter_start=7 + 2 * v,
                chapter_end=8 + 2 * v,
                generated_at=datetime.now(UTC),
            )
        )
        db_session.add(BookSeries(book_id=gen_book.id, series_id=series.id, sequence=v + 1))

    await db_session.commit()
    return serial, series, ebooks


async def _volumes(client, serial_id: int) -> list[dict]:
    resp = await client.get(f"/api/serials/{serial_id}/volumes")
    assert resp.status_code == 200
    return resp.json()


@pytest.mark.asyncio
async def test_link_ebook_inserts_before_generated_volumes(client, db_session, tmp_path):
    serial, series, (book1, book2) = await _seed(db_session, tmp_path, generated=2)
    series_id = series.id

    resp = await client.post(
        f"/api/serials/{serial.id}/volumes/link-ebook",
        json={"book_id": book1.id, "volume_number": 1, "chapter_start": 1, "chapter_end": 3},
    )
    assert resp.status_code == 201
    linked = resp.json()
    assert linked["kind"] == "ebook"
    assert linked["volume_number"] == 1
    assert linked["name"] == "Serial Book 1"  # defaults to the book title
    assert (linked["chapter_start"], linked["chapter_end"]) == (1, 3)
    assert linked["is_partial"] is False

    resp = await client.post(
        f"/api/serials/{serial.id}/volumes/link-ebook",
        json={"book_id": book2.id, "volume_number": 2},
    )
    assert resp.status_code == 201
    assert resp.json()["chapter_start"] is None

    vols = await _volumes(client, serial.id)
    assert [(v["volume_number"], v["kind"], v["name"]) for v in vols] == [
        (1, "ebook", "Serial Book 1"),
        (2, "ebook", "Serial Book 2"),
        (3, "generated", None),
        (4, "generated", None),
    ]
    # Unnamed generated EPUBs carry "Volume N" in their title, so renumbering
    # marks them for a rebuild.
    assert all(v["is_stale"] for v in vols if v["kind"] == "generated")

    # The series reading order follows the new numbering.
    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(Book.title, BookSeries.sequence)
            .join(BookSeries, BookSeries.book_id == Book.id)
            .where(BookSeries.series_id == series_id)
            .order_by(BookSeries.sequence)
        )
    ).all()
    assert [(t, s) for t, s in rows] == [
        ("Serial Book 1", 1.0),
        ("Serial Book 2", 2.0),
        ("Serial - Volume 1", 3.0),
        ("Serial - Volume 2", 4.0),
    ]


@pytest.mark.asyncio
async def test_link_ebook_appends_by_default(client, db_session, tmp_path):
    serial, _, (book1, _) = await _seed(db_session, tmp_path, generated=1)
    resp = await client.post(
        f"/api/serials/{serial.id}/volumes/link-ebook", json={"book_id": book1.id}
    )
    assert resp.status_code == 201
    assert resp.json()["volume_number"] == 2
    vols = await _volumes(client, serial.id)
    assert vols[0]["is_stale"] is False  # nothing was renumbered


@pytest.mark.asyncio
async def test_link_ebook_errors(client, db_session, tmp_path):
    serial, _, (book1, _) = await _seed(db_session, tmp_path)
    url = f"/api/serials/{serial.id}/volumes/link-ebook"

    assert (await client.post(url, json={"book_id": "missing"})).status_code == 404
    assert (
        await client.post("/api/serials/9999/volumes/link-ebook", json={"book_id": book1.id})
    ).status_code == 404
    # Half a chapter range, or a backwards one, is rejected.
    assert (
        await client.post(url, json={"book_id": book1.id, "chapter_start": 1})
    ).status_code == 422
    assert (
        await client.post(url, json={"book_id": book1.id, "chapter_start": 5, "chapter_end": 2})
    ).status_code == 422

    assert (await client.post(url, json={"book_id": book1.id})).status_code == 201
    dup = await client.post(url, json={"book_id": book1.id})
    assert dup.status_code == 409
    assert "already" in dup.json()["detail"]


@pytest.mark.asyncio
async def test_linked_ebook_is_never_generated_or_deleted(client, db_session, tmp_path):
    serial, _, (book1, _) = await _seed(db_session, tmp_path)
    vol = (
        await client.post(
            f"/api/serials/{serial.id}/volumes/link-ebook",
            json={"book_id": book1.id, "chapter_start": 1, "chapter_end": 6},
        )
    ).json()
    base = f"/api/serials/{serial.id}/volumes/{vol['id']}"

    assert (await client.post(f"{base}/generate")).status_code == 422
    assert (await client.post(f"{base}/rebuild")).status_code == 422
    # "Generate all" skips linked ebooks instead of rebuilding them.
    all_resp = await client.post(f"/api/serials/{serial.id}/volumes/generate-all")
    assert all_resp.status_code == 200
    assert all_resp.json() == []
    assert (tmp_path / "book1.epub").read_bytes() == b"purchased ebook"

    # Removing it from the serial only unlinks it, even with delete_book=true.
    book1_id = book1.id
    assert (await client.delete(f"{base}?delete_book=true")).status_code == 204
    assert await _volumes(client, serial.id) == []
    db_session.expire_all()
    assert await db_session.scalar(select(Book).where(Book.id == book1_id)) is not None
    assert (tmp_path / "book1.epub").exists()


@pytest.mark.asyncio
async def test_auto_split_starts_after_ebook_chapters(client, db_session, tmp_path):
    serial, _, (book1, _) = await _seed(db_session, tmp_path)
    await client.post(
        f"/api/serials/{serial.id}/volumes/link-ebook",
        json={"book_id": book1.id, "chapter_start": 1, "chapter_end": 6},
    )
    resp = await client.post(
        f"/api/serials/{serial.id}/volumes/auto", json={"chapters_per_volume": 2}
    )
    assert resp.status_code == 201
    vols = await _volumes(client, serial.id)
    assert [(v["kind"], v["chapter_start"], v["chapter_end"]) for v in vols] == [
        ("ebook", 1, 6),
        ("generated", 7, 8),
        ("generated", 9, 10),
    ]
    assert [v["volume_number"] for v in vols] == [1, 2, 3]


@pytest.mark.asyncio
async def test_chapter_changes_never_mark_ebooks_stale(db_session, tmp_path):
    from app.schemas.serial import EbookVolumeLink
    from app.services.serial_service import (
        _mark_generated_volumes_stale,
        link_ebook_volume,
    )

    serial, _, (book1, _) = await _seed(db_session, tmp_path)
    vol = await link_ebook_volume(
        db_session,
        serial.id,
        EbookVolumeLink(book_id=book1.id, chapter_start=1, chapter_end=6),
    )
    vol_id = vol.id
    await _mark_generated_volumes_stale(db_session, serial.id, {2, 3})
    await db_session.commit()
    refreshed = await db_session.scalar(select(SerialVolume).where(SerialVolume.id == vol_id))
    assert refreshed.is_stale is False


@pytest.mark.asyncio
async def test_link_ebook_only_shifts_the_run_that_collides(client, db_session, tmp_path):
    serial, _, (book1, book2) = await _seed(db_session, tmp_path, generated=2)
    # Leave a gap: volumes are #1 and #2; move #2 to #4.
    await db_session.execute(
        SerialVolume.__table__.update()
        .where(SerialVolume.serial_id == serial.id, SerialVolume.volume_number == 2)
        .values(volume_number=4)
    )
    await db_session.commit()
    url = f"/api/serials/{serial.id}/volumes/link-ebook"

    # #3 is free: nothing moves.
    assert (
        await client.post(url, json={"book_id": book1.id, "volume_number": 3})
    ).status_code == 201
    assert [v["volume_number"] for v in await _volumes(client, serial.id)] == [1, 3, 4]

    # #1 is taken: only #1 moves (to #2, the gap); #3 and #4 stay put.
    assert (
        await client.post(url, json={"book_id": book2.id, "volume_number": 1})
    ).status_code == 201
    vols = await _volumes(client, serial.id)
    assert [(v["volume_number"], v["kind"]) for v in vols] == [
        (1, "ebook"),
        (2, "generated"),
        (3, "ebook"),
        (4, "generated"),
    ]
    assert [v["is_stale"] for v in vols if v["kind"] == "generated"] == [True, False]


@pytest.mark.asyncio
async def test_rebuild_tidies_file_and_auto_title(db_session, tmp_path):
    from app.services.serial_service import _tidy_rebuilt_volume_book

    serial, _, _ = await _seed(db_session, tmp_path, generated=1)
    vol = await db_session.scalar(select(SerialVolume).where(SerialVolume.serial_id == serial.id))
    book = await db_session.scalar(select(Book).where(Book.id == vol.book_id))
    old_file = tmp_path / "serial-volume-1.epub"
    old_file.write_bytes(b"old")
    (tmp_path / "serial-volume-3.epub").write_bytes(b"new")
    vol.volume_number = 3
    book.file_path = "serial-volume-3.epub"
    await db_session.commit()

    await _tidy_rebuilt_volume_book(db_session, serial.id, vol, old_file, "Serial - Volume 1")
    await db_session.refresh(book)
    assert not old_file.exists()
    assert (tmp_path / "serial-volume-3.epub").exists()
    assert book.title == "Serial - Volume 3"

    # A title the user edited is left alone.
    book.title = "My Favourite Arc"
    await db_session.commit()
    await _tidy_rebuilt_volume_book(db_session, serial.id, vol, None, "My Favourite Arc")
    await db_session.refresh(book)
    assert book.title == "My Favourite Arc"
