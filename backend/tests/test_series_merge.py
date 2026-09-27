"""Tests for merging series, and folding an ebook series into a serial's series."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.lens import Lens
from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.series import BookSeries, ReadingOrder, Series
from app.models.shelf import Shelf


async def _book(db_session, shelf, title: str) -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        format="epub",
        file_path=f"{title}.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.flush()
    return book


async def _shelf(db_session, tmp_path: Path) -> Shelf:
    shelf = Shelf(name="Library", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.flush()
    return shelf


async def _entries(db_session, series_id: int) -> list[tuple[str, float | None]]:
    rows = await db_session.execute(
        select(Book.title, BookSeries.sequence)
        .join(BookSeries, BookSeries.book_id == Book.id)
        .where(BookSeries.series_id == series_id)
        .order_by(BookSeries.sequence, Book.title)
    )
    return [(t, s) for t, s in rows]


# ---------------------------------------------------------------------------
# Plain series merge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_merge_moves_books_orders_children_and_lenses(client, db_session, tmp_path):
    shelf = await _shelf(db_session, tmp_path)
    source = Series(name="Old", description="From the ebooks")
    target = Series(name="New")
    db_session.add_all([source, target])
    await db_session.flush()
    child = Series(name="Side stories", parent_id=source.id)
    db_session.add(child)
    a, b, shared = [await _book(db_session, shelf, t) for t in ("A", "B", "Shared")]
    db_session.add_all(
        [
            BookSeries(book_id=a.id, series_id=source.id, sequence=1),
            BookSeries(book_id=b.id, series_id=source.id, sequence=2),
            BookSeries(book_id=shared.id, series_id=source.id, sequence=9),
            BookSeries(book_id=shared.id, series_id=target.id, sequence=3),
            ReadingOrder(name="Chronological", series_id=source.id),
            Lens(name="Both", filter_state=json.dumps({"series_ids": [source.id, target.id]})),
        ]
    )
    await db_session.commit()
    source_id, target_id, child_id = source.id, target.id, child.id

    resp = await client.post(f"/api/series/{target_id}/merge", json={"source_id": source_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["merged_from"] == "Old"
    assert (data["moved_books"], data["already_in_target"]) == (2, 1)
    assert data["series"]["name"] == "New"
    assert data["series"]["description"] == "From the ebooks"  # target had none

    db_session.expire_all()
    # The target's position wins for a book that was in both.
    assert await _entries(db_session, target_id) == [("A", 1.0), ("B", 2.0), ("Shared", 3.0)]
    assert await db_session.get(Series, source_id) is None
    assert (await db_session.get(Series, child_id)).parent_id == target_id
    order = await db_session.scalar(select(ReadingOrder))
    assert order.series_id == target_id
    lens = await db_session.scalar(select(Lens))
    assert json.loads(lens.filter_state)["series_ids"] == [target_id]


@pytest.mark.asyncio
async def test_merge_errors(client, db_session):
    parent = Series(name="Parent")
    db_session.add(parent)
    await db_session.flush()
    child = Series(name="Child", parent_id=parent.id)
    db_session.add(child)
    await db_session.commit()

    same = await client.post(f"/api/series/{parent.id}/merge", json={"source_id": parent.id})
    assert same.status_code == 400
    # Merging a parent into its own sub-series would make a loop.
    loop = await client.post(f"/api/series/{child.id}/merge", json={"source_id": parent.id})
    assert loop.status_code == 400
    assert "other way round" in loop.json()["detail"]
    missing = await client.post(f"/api/series/{parent.id}/merge", json={"source_id": 999})
    assert missing.status_code == 404

    # The other way round is fine: the child's contents join the parent.
    ok = await client.post(f"/api/series/{parent.id}/merge", json={"source_id": child.id})
    assert ok.status_code == 200


# ---------------------------------------------------------------------------
# Ebook series → serial series
# ---------------------------------------------------------------------------


async def _ebooks_then_serial(db_session, tmp_path, *, generated: int = 2):
    """The user's library already has the ebooks in a series; then the serial is added."""
    shelf = await _shelf(db_session, tmp_path)
    ebook_series = Series(name="Mother of Learning")
    serial_series = Series(name="Mother of Learning")
    db_session.add_all([ebook_series, serial_series])
    await db_session.flush()
    ebooks = []
    for i in (1, 2, 3):
        book = await _book(db_session, shelf, f"Mother of Learning: Book {i}")
        db_session.add(BookSeries(book_id=book.id, series_id=ebook_series.id, sequence=i))
        ebooks.append(book)

    serial = WebSerial(
        url="https://www.royalroad.com/fiction/21220/mother-of-learning",
        source="royalroad",
        title="Mother of Learning",
        status="completed",
        total_chapters=10,
        live_chapter_count=10,
        series_id=serial_series.id,
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
            )
        )
    for v in range(generated):
        gen = await _book(db_session, shelf, f"Mother of Learning - Volume {v + 1}")
        db_session.add(
            SerialVolume(
                serial_id=serial.id,
                volume_number=v + 1,
                book_id=gen.id,
                chapter_start=1 + 5 * v,
                chapter_end=5 + 5 * v,
                generated_at=datetime.now(UTC),
            )
        )
        db_session.add(BookSeries(book_id=gen.id, series_id=serial_series.id, sequence=v + 1))
    await db_session.commit()
    return serial, ebook_series, serial_series, ebooks


@pytest.mark.asyncio
async def test_serial_suggests_the_ebook_series(client, db_session, tmp_path):
    serial, ebook_series, _, _ = await _ebooks_then_serial(db_session, tmp_path)
    # A series belonging to another serial is never suggested, even if the name matches.
    other_series = Series(name="Mother of Learning")
    db_session.add(other_series)
    await db_session.flush()
    db_session.add(
        WebSerial(
            url="https://example.com/other",
            source="royalroad",
            title="Other",
            total_chapters=0,
            live_chapter_count=0,
            series_id=other_series.id,
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/serials/{serial.id}/series-merge-candidates")
    assert resp.status_code == 200
    [candidate] = resp.json()
    assert candidate["series_id"] == ebook_series.id
    assert candidate["reasons"] == ["same_name"]
    assert [b["title"] for b in candidate["books"]] == [
        "Mother of Learning: Book 1",
        "Mother of Learning: Book 2",
        "Mother of Learning: Book 3",
    ]
    assert not any(b["linked"] for b in candidate["books"])


@pytest.mark.asyncio
async def test_linked_ebook_series_is_suggested_whatever_its_name(client, db_session, tmp_path):
    serial, ebook_series, _, (book1, _, _) = await _ebooks_then_serial(db_session, tmp_path)
    ebook_series.name = "MoL (Kindle)"
    await db_session.commit()
    assert (await client.get(f"/api/serials/{serial.id}/series-merge-candidates")).json() == []

    await client.post(f"/api/serials/{serial.id}/volumes/link-ebook", json={"book_id": book1.id})
    [candidate] = (await client.get(f"/api/serials/{serial.id}/series-merge-candidates")).json()
    assert candidate["reasons"] == ["linked_ebook"]
    assert [b["linked"] for b in candidate["books"]] == [True, False, False]


@pytest.mark.asyncio
async def test_merge_into_serial_links_ebooks_first_and_deletes_old_series(
    client, db_session, tmp_path
):
    serial, ebook_series, serial_series, _ = await _ebooks_then_serial(db_session, tmp_path)
    ebook_series_id, serial_series_id = ebook_series.id, serial_series.id
    serial_id = serial.id

    resp = await client.post(
        f"/api/serials/{serial_id}/merge-series", json={"series_id": ebook_series_id}
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "series_id": serial_series_id,
        "series_name": "Mother of Learning",
        "merged_from": "Mother of Learning",
        "moved_books": 0,  # all three were linked (and so added) first
        "linked_volumes": 3,
    }

    vols = (await client.get(f"/api/serials/{serial.id}/volumes")).json()
    assert [(v["volume_number"], v["kind"], v["name"]) for v in vols] == [
        (1, "ebook", "Mother of Learning: Book 1"),
        (2, "ebook", "Mother of Learning: Book 2"),
        (3, "ebook", "Mother of Learning: Book 3"),
        (4, "generated", None),
        (5, "generated", None),
    ]
    db_session.expire_all()
    assert await db_session.get(Series, ebook_series_id) is None
    assert await _entries(db_session, serial_series_id) == [
        ("Mother of Learning: Book 1", 1.0),
        ("Mother of Learning: Book 2", 2.0),
        ("Mother of Learning: Book 3", 3.0),
        ("Mother of Learning - Volume 1", 4.0),
        ("Mother of Learning - Volume 2", 5.0),
    ]
    assert (await client.get(f"/api/serials/{serial_id}/series-merge-candidates")).json() == []


@pytest.mark.asyncio
async def test_merge_into_serial_keeps_existing_links_and_can_skip_linking(
    client, db_session, tmp_path
):
    serial, ebook_series, serial_series, (book1, _, _) = await _ebooks_then_serial(
        db_session, tmp_path, generated=1
    )
    ebook_series_id, serial_series_id = ebook_series.id, serial_series.id
    # Book 1 is already linked (at the front).
    await client.post(
        f"/api/serials/{serial.id}/volumes/link-ebook",
        json={"book_id": book1.id, "volume_number": 1},
    )
    resp = await client.post(
        f"/api/serials/{serial.id}/merge-series",
        json={"series_id": ebook_series_id, "link_as_volumes": False},
    )
    assert resp.status_code == 200
    assert (resp.json()["moved_books"], resp.json()["linked_volumes"]) == (2, 0)
    vols = (await client.get(f"/api/serials/{serial.id}/volumes")).json()
    assert [v["kind"] for v in vols] == ["ebook", "generated"]
    db_session.expire_all()
    assert await _entries(db_session, serial_series_id) == [
        ("Mother of Learning: Book 1", 1.0),
        ("Mother of Learning - Volume 1", 2.0),
        ("Mother of Learning: Book 2", 2.0),
        ("Mother of Learning: Book 3", 3.0),
    ]


@pytest.mark.asyncio
async def test_merge_into_serial_errors(client, db_session, tmp_path):
    serial, _, serial_series, _ = await _ebooks_then_serial(db_session, tmp_path)
    url = f"/api/serials/{serial.id}/merge-series"
    assert (await client.post(url, json={"series_id": serial_series.id})).status_code == 409
    assert (await client.post(url, json={"series_id": 999})).status_code == 404
    assert (
        await client.post("/api/serials/999/merge-series", json={"series_id": 1})
    ).status_code == 404


@pytest.mark.asyncio
async def test_serial_without_a_series_adopts_the_ebook_series(client, db_session, tmp_path):
    serial, ebook_series, serial_series, _ = await _ebooks_then_serial(
        db_session, tmp_path, generated=0
    )
    serial.series_id = None
    await db_session.commit()
    resp = await client.post(
        f"/api/serials/{serial.id}/merge-series", json={"series_id": ebook_series.id}
    )
    assert resp.status_code == 200
    assert resp.json()["series_id"] == ebook_series.id
    assert (await client.get(f"/api/serials/{serial.id}")).json()["series_id"] == ebook_series.id
