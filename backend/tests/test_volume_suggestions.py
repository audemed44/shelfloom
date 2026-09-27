"""Tests for book-length volume suggestions."""

from __future__ import annotations

import uuid

import pytest

from app.models.book import Book
from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.shelf import Shelf
from app.services.serial_service import _ChapterLength, suggest_volume_splits

WPP = 280  # words per page
MIN, MAX = 500 * WPP, 600 * WPP  # 140k–168k words


def _chapters(*words: int) -> list[_ChapterLength]:
    return [_ChapterLength(i + 1, w, False) for i, w in enumerate(words)]


def test_splits_evenly_sized_chapters_into_book_length_volumes():
    # 30 chapters of 10k words = 300k words: two ~150k (535 page) books.
    result = suggest_volume_splits(_chapters(*[10_000] * 30), MIN, MAX, ongoing=False)
    assert [(s.start, s.end) for s in result] == [(1, 15), (16, 30)]
    assert all(500 <= s.estimated_pages <= 600 for s in result)
    assert not any(s.in_progress for s in result)


def test_every_volume_stays_within_range_when_chapters_allow():
    words = [3_000 + (i * 997) % 6_000 for i in range(200)]  # uneven lengths
    result = suggest_volume_splits(_chapters(*words), MIN, MAX, ongoing=True)
    for s in result[:-1]:
        assert 500 <= s.estimated_pages <= 600, s
    # Contiguous, no gaps or overlaps, every chapter used once.
    assert result[0].start == 1 and result[-1].end == 200
    for a, b in zip(result, result[1:]):
        assert b.start == a.end + 1


def test_cuts_at_the_boundary_closest_to_the_middle_of_the_range():
    # After 14 chapters we're at 140k (the minimum); ch 15 takes us to 150k,
    # nearer the 154k middle, and ch 16 would overshoot, so cut after ch 15.
    result = suggest_volume_splits(_chapters(*[10_000] * 16, 100_000), MIN, MAX, ongoing=False)
    assert (result[0].start, result[0].end) == (1, 15)


def test_huge_single_chapter_goes_where_it_lands_closer_to_the_middle():
    # 100k so far; adding a 90k chapter gives 190k (36k over the middle)
    # versus stopping at 100k (54k under), so the chapter is kept.
    result = suggest_volume_splits(
        _chapters(50_000, 50_000, 90_000, 10_000), MIN, MAX, ongoing=True
    )
    assert [(s.start, s.end, s.in_progress) for s in result] == [(1, 3, False), (4, 4, True)]


def test_ongoing_serial_leaves_an_in_progress_final_volume():
    result = suggest_volume_splits(_chapters(*[10_000] * 20), MIN, MAX, ongoing=True)
    assert [(s.start, s.end, s.in_progress) for s in result] == [
        (1, 15, False),
        (16, 20, True),
    ]


def test_finished_serial_folds_a_tiny_leftover_into_the_last_volume():
    # 15 chapters make a volume; the 2 left over (20k) are under half the
    # minimum, so they join it rather than becoming a 71-page "book".
    result = suggest_volume_splits(_chapters(*[10_000] * 17), MIN, MAX, ongoing=False)
    assert [(s.start, s.end) for s in result] == [(1, 17)]


def test_counts_chapters_whose_length_was_estimated():
    chapters = [_ChapterLength(i + 1, 10_000, i >= 10) for i in range(15)]
    result = suggest_volume_splits(chapters, MIN, MAX, ongoing=False)
    assert result[0].estimated_chapter_count == 5


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


async def _serial(db_session, tmp_path, *, chapters: int, fetched: int, status="ongoing"):
    serial = WebSerial(
        url=f"https://www.royalroad.com/fiction/{uuid.uuid4().hex[:6]}/s",
        source="royalroad",
        title="Serial",
        status=status,
        total_chapters=chapters,
        live_chapter_count=chapters,
    )
    db_session.add(serial)
    await db_session.flush()
    for n in range(1, chapters + 1):
        db_session.add(
            SerialChapter(
                serial_id=serial.id,
                chapter_number=n,
                source_key=f"k{n}",
                source_url=f"https://www.royalroad.com/ch/{n}",
                content="<p>x</p>" if n <= fetched else None,
                word_count=5_000 if n <= fetched else None,
            )
        )
    await db_session.commit()
    return serial


@pytest.mark.asyncio
async def test_api_suggests_after_built_volumes_and_estimates_unfetched(
    client, db_session, tmp_path
):
    serial = await _serial(db_session, tmp_path, chapters=120, fetched=80)
    shelf = Shelf(name="Lib", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.flush()
    book = Book(
        id=str(uuid.uuid4()),
        title="Serial - Volume 1",
        format="epub",
        shelf_id=shelf.id,
        file_path="v1",
    )
    db_session.add(book)
    await db_session.flush()
    db_session.add(
        SerialVolume(
            serial_id=serial.id,
            volume_number=1,
            book_id=book.id,
            chapter_start=1,
            chapter_end=30,
        )
    )
    await db_session.commit()

    resp = await client.post(f"/api/serials/{serial.id}/volumes/suggest", json={})
    assert resp.status_code == 200
    data = resp.json()
    assert data["start_chapter"] == 31  # chapters 1–30 are already built
    assert data["average_chapter_words"] == 5_000
    suggestions = data["suggestions"]
    assert suggestions[0]["start"] == 31
    assert suggestions[-1]["end"] == 120
    # 5k-word chapters: 31 chapters = 155k words, closest to the 154k middle
    # of 500–600 pages (140k–168k words).
    assert (suggestions[0]["start"], suggestions[0]["end"]) == (31, 61)
    assert suggestions[0]["estimated_pages"] == 554
    # Chapters 81–120 aren't fetched, so their length is the average.
    assert suggestions[-1]["estimated_chapter_count"] > 0


@pytest.mark.asyncio
async def test_api_respects_custom_target_size(client, db_session, tmp_path):
    serial = await _serial(db_session, tmp_path, chapters=60, fetched=60, status="completed")
    resp = await client.post(
        f"/api/serials/{serial.id}/volumes/suggest",
        json={"min_pages": 250, "max_pages": 300},
    )
    sizes = [s["estimated_pages"] for s in resp.json()["suggestions"]]
    assert len(sizes) == 4
    assert all(250 <= p <= 300 for p in sizes)


@pytest.mark.asyncio
async def test_api_explains_when_it_cannot_suggest(client, db_session, tmp_path):
    none_fetched = await _serial(db_session, tmp_path, chapters=10, fetched=0)
    data = (await client.post(f"/api/serials/{none_fetched.id}/volumes/suggest")).json()
    assert data["suggestions"] == []
    assert "Fetch some chapters" in data["reason"]

    bad = await client.post(
        f"/api/serials/{none_fetched.id}/volumes/suggest",
        json={"min_pages": 600, "max_pages": 500},
    )
    assert bad.status_code == 422
    assert (await client.post("/api/serials/9999/volumes/suggest")).status_code == 404
