"""Reading positions follow chapters when a serial volume is rebuilt."""

from __future__ import annotations

import hashlib
import uuid

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.kosync import KoSyncProgress
from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.shelf import Shelf
from app.services.kosync_service import epub_spine, remap_position

OLD = [("nav.xhtml", 100), ("chapter_0003.xhtml", 1000), ("chapter_0004.xhtml", 1000)]
# Chapters 1–2 were added in front, chapter 5 at the end.
NEW = [
    ("nav.xhtml", 100),
    ("chapter_0001.xhtml", 1000),
    ("chapter_0002.xhtml", 1000),
    ("chapter_0003.xhtml", 1000),
    ("chapter_0004.xhtml", 1000),
    ("chapter_0005.xhtml", 1000),
]


def test_position_follows_its_chapter():
    # Half-way through chapter 4 (the 3rd spine item of the old build).
    old_pct = (100 + 1000 + 500) / 2100
    progress, pct = remap_position("/body/DocFragment[3]/body/p[7]/text().12", old_pct, OLD, NEW)
    assert progress == "/body/DocFragment[5]/body/p[7]/text().12"
    assert pct == pytest.approx((100 + 3000 + 500) / 5100)


def test_removed_chapter_moves_to_the_next_one():
    shrunk = [("nav.xhtml", 100), ("chapter_0004.xhtml", 1000)]
    progress, pct = remap_position("/body/DocFragment[2]/body/p[3]/text().5", 0.3, OLD, shrunk)
    assert progress == "/body/DocFragment[2]/body"
    assert pct == pytest.approx(100 / 1100)


def test_unchanged_layout_needs_nothing():
    assert remap_position("/body/DocFragment[2]/body/p", 0.3, OLD, OLD) is None
    assert remap_position("not an xpointer", 0.3, OLD, NEW) is None
    assert remap_position("/body/DocFragment[9]/body", 0.3, OLD, NEW) is None


# ---------------------------------------------------------------------------
# A real rebuild
# ---------------------------------------------------------------------------


async def _serial_with_volume(db_session, tmp_path, *, start: int, end: int):
    shelf = Shelf(name="Library", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.flush()
    serial = WebSerial(
        url="https://www.royalroad.com/fiction/1/s",
        source="royalroad",
        title="Serial",
        status="ongoing",
        total_chapters=6,
        live_chapter_count=6,
    )
    db_session.add(serial)
    await db_session.flush()
    for n in range(1, 7):
        db_session.add(
            SerialChapter(
                serial_id=serial.id,
                chapter_number=n,
                source_key=f"k{n}",
                source_url=f"https://www.royalroad.com/ch/{n}",
                title=f"Chapter {n}",
                content="".join(f"<p>Chapter {n}, paragraph {i}.</p>" for i in range(40)),
                word_count=400,
            )
        )
    vol = SerialVolume(serial_id=serial.id, volume_number=1, chapter_start=start, chapter_end=end)
    db_session.add(vol)
    await db_session.commit()
    return serial.id, vol.id, shelf.id


@pytest.mark.asyncio
async def test_rebuild_moves_the_kindle_position_to_the_same_chapter(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setenv("SHELFLOOM_COVERS_DIR", str(tmp_path / "covers"))
    serial_id, vol_id, shelf_id = await _serial_with_volume(db_session, tmp_path, start=3, end=4)
    base = f"/api/serials/{serial_id}/volumes/{vol_id}"
    assert (await client.post(f"{base}/generate", params={"shelf_id": shelf_id})).status_code == 200

    book = await db_session.scalar(select(Book))
    book_id, digest = book.id, book.file_hash_md5_ko
    old_spine = epub_spine(tmp_path / book.file_path)
    assert [h for h, _ in old_spine][1:] == ["chapter_0003.xhtml", "chapter_0004.xhtml"]

    # KOReader is part-way through chapter 4 (DocFragment 3: nav, ch 3, ch 4).
    key = hashlib.md5(b"pw").hexdigest()
    ko = {"x-auth-user": "kindle", "x-auth-key": key}
    await client.post("/api/kosync/users/create", json={"username": "kindle", "password": key})
    await client.put(
        "/api/kosync/syncs/progress",
        json={
            "document": digest,
            "progress": "/body/DocFragment[3]/body/p[20]/text().4",
            "percentage": 0.75,
            "device": "Kindle",
            "device_id": "K1",
        },
        headers=ko,
    )

    # The volume now starts at chapter 1: chapter 4 becomes the 5th spine item.
    await db_session.execute(
        SerialVolume.__table__.update()
        .where(SerialVolume.id == vol_id)
        .values(chapter_start=1, chapter_end=5)
    )
    await db_session.commit()
    assert (await client.post(f"{base}/rebuild")).status_code == 200

    # KOReader (still sending the digest it cached) is sent to the same place
    # in the new layout, as a newer record not from itself, so it follows it.
    pulled = (await client.get(f"/api/kosync/syncs/progress/{digest}", headers=ko)).json()
    assert pulled["progress"] == "/body/DocFragment[5]/body/p[20]/text().4"
    assert pulled["device_id"] == "shelfloom-rebuild"
    assert pulled["device_id"] != "K1"
    assert 0.6 < pulled["percentage"] < 0.8  # chapter 4 of 5, part-way through

    # The web reader resumes there too (no stale locator from the old build).
    pos = (await client.get(f"/api/books/{book_id}/position")).json()
    assert pos["progress"] == pulled["progress"]
    assert pos["locator"] is None

    # A rebuild that changes nothing leaves positions alone.
    before = await db_session.scalar(select(KoSyncProgress.id).order_by(KoSyncProgress.id.desc()))
    assert (await client.post(f"{base}/rebuild")).status_code == 200
    db_session.expire_all()
    after = await db_session.scalar(select(KoSyncProgress.id).order_by(KoSyncProgress.id.desc()))
    assert before == after
    assert uuid.UUID(book_id)
