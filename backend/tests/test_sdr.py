"""Tests for .sdr data ingestion (step 2.2)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.models.reading import Highlight, ReadingProgress, ReadingSession

FIXTURES = Path(__file__).parent / "fixtures"


# ── sdr_reader ────────────────────────────────────────────────────────────────


def test_read_sdr_from_fixture(tmp_path):
    """Parse the test metadata.epub.lua fixture correctly."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    fixture_src = FIXTURES / "metadata.epub.lua"
    (sdr_dir / "metadata.epub.lua").write_bytes(fixture_src.read_bytes())

    data = read_sdr(sdr_dir)
    assert data is not None
    assert data.partial_md5 == "abc123def456abc1"
    assert data.title == "The Way of Kings"
    assert data.authors == "Brandon Sanderson"
    assert abs(data.percent_finished - 0.73) < 0.001
    assert data.status == "reading"
    assert data.doc_pages == 1258
    assert data.last_xpointer is not None
    assert data.total_time_in_sec == 72000


def test_read_sdr_annotations(tmp_path):
    """Annotations extracted correctly."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    (sdr_dir / "metadata.epub.lua").write_bytes((FIXTURES / "metadata.epub.lua").read_bytes())

    data = read_sdr(sdr_dir)
    assert data is not None
    assert len(data.annotations) == 2

    ann1 = data.annotations[0]
    assert ann1.text == "Life before death."
    assert ann1.note == "Interesting motto"
    assert ann1.chapter == "Prelude to the Stormlight Archive"
    assert ann1.page == 5
    assert ann1.datetime == datetime(2024, 1, 15, 20, 30, 0)

    ann2 = data.annotations[1]
    assert ann2.text == "The question was not how to survive."
    assert ann2.note is None  # empty string -> None
    assert ann2.chapter == "Chapter 1"
    assert ann2.page == 42


def test_read_sdr_performance_in_pages(tmp_path):
    """Performance in pages extracted correctly."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    (sdr_dir / "metadata.epub.lua").write_bytes((FIXTURES / "metadata.epub.lua").read_bytes())

    data = read_sdr(sdr_dir)
    assert data is not None
    assert isinstance(data.performance_in_pages, dict)
    # Fixture has 4 timestamps
    assert len(data.performance_in_pages) == 4
    assert data.performance_in_pages[1705359000] == 30


def test_read_sdr_no_metadata_file(tmp_path):
    """Returns None when no metadata.*.lua found."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    result = read_sdr(sdr_dir)
    assert result is None


def test_read_sdr_not_a_directory(tmp_path):
    """Returns None when path is not a directory."""
    from app.koreader.sdr_reader import read_sdr

    result = read_sdr(tmp_path / "nonexistent.sdr")
    assert result is None


def test_read_sdr_empty_performance(tmp_path):
    """Empty performance_in_pages is handled gracefully."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    lua_content = """return {
        ["partial_md5_checksum"] = "abc123",
        ["percent_finished"] = 0.5,
        ["stats"] = {
            ["performance_in_pages"] = {},
            ["total_time_in_sec"] = 0,
        },
        ["summary"] = { ["status"] = "reading" },
    }"""
    (sdr_dir / "metadata.epub.lua").write_text(lua_content)

    data = read_sdr(sdr_dir)
    assert data is not None
    assert data.performance_in_pages == {}
    assert data.annotations == []


def test_read_sdr_invalid_lua(tmp_path):
    """Returns None when Lua file is invalid."""
    from app.koreader.sdr_reader import read_sdr

    sdr_dir = tmp_path / "book.epub.sdr"
    sdr_dir.mkdir()
    (sdr_dir / "metadata.epub.lua").write_text("this is not valid lua!!!")

    result = read_sdr(sdr_dir)
    assert result is None


# ── session aggregation ───────────────────────────────────────────────────────


def test_session_aggregation_close_timestamps():
    """3 close timestamps → 1 session."""
    from app.koreader.sdr_importer import _aggregate_sessions

    perf = {
        1705359000: 30,
        1705359060: 25,
        1705359120: 20,
    }
    sessions = _aggregate_sessions(perf, "md5abc", None)
    assert len(sessions) == 1
    assert sessions[0]["pages_read"] == 75
    assert sessions[0]["source_key"].startswith("sdr:md5abc:")


def test_session_aggregation_gap():
    """Gap > 10 min → 2 sessions."""
    from app.koreader.sdr_importer import _aggregate_sessions

    perf = {
        1705359000: 30,
        1705359060: 25,
        1705365600: 45,  # 1.8 hours later
    }
    sessions = _aggregate_sessions(perf, "md5abc", None)
    assert len(sessions) == 2
    assert sessions[0]["pages_read"] == 55
    assert sessions[1]["pages_read"] == 45


def test_session_aggregation_empty():
    """Empty performance dict → no sessions."""
    from app.koreader.sdr_importer import _aggregate_sessions

    sessions = _aggregate_sessions({}, None, None)
    assert sessions == []


def test_session_aggregation_four_timestamps_two_sessions():
    """Fixture data: timestamps 1705359000 and 1705359060 are close (same session);
    1705365600 and 1705451400 are each separated by a gap → 3 sessions total.
    """
    from app.koreader.sdr_importer import _aggregate_sessions

    perf = {
        1705359000: 30,
        1705359060: 25,
        1705365600: 45,
        1705451400: 60,
    }
    sessions = _aggregate_sessions(perf, "abc", None)
    assert len(sessions) == 3


# ── import_sdr ────────────────────────────────────────────────────────────────


async def test_import_sdr_creates_progress(db_session, book_factory, shelf_factory):
    """import_sdr creates reading progress."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory()

    sdr_data = SdrReadingData(
        partial_md5="abc123",
        doc_path="/mnt/us/book.epub",
        title="Test Book",
        authors="Test Author",
        percent_finished=0.5,
        last_xpointer="/body/p[1].0",
        doc_pages=300,
        status="reading",
        performance_in_pages={},
        total_time_in_sec=3600,
        annotations=[],
        raw={},
    )

    counts = await import_sdr(db_session, book, sdr_data)
    assert counts["progress"] == 1

    result = await db_session.execute(
        select(ReadingProgress).where(ReadingProgress.book_id == book.id)
    )
    progress = result.scalar_one_or_none()
    assert progress is not None
    assert abs(progress.progress - 50.0) < 0.001


async def test_import_sdr_creates_highlights(db_session, book_factory, shelf_factory):
    """import_sdr creates highlights."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrAnnotation, SdrReadingData

    await shelf_factory()
    book = await book_factory()

    ann = SdrAnnotation(
        text="Life before death.",
        note="A motto",
        chapter="Prelude",
        page=5,
        datetime=datetime(2024, 1, 15, 20, 30),
    )
    sdr_data = SdrReadingData(
        partial_md5=None,
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[ann],
        raw={},
    )

    counts = await import_sdr(db_session, book, sdr_data)
    assert counts["highlights"] == 1

    result = await db_session.execute(select(Highlight).where(Highlight.book_id == book.id))
    hl = result.scalar_one_or_none()
    assert hl is not None
    assert hl.text == "Life before death."
    assert hl.note == "A motto"


async def test_import_sdr_creates_sessions(db_session, book_factory, shelf_factory):
    """import_sdr creates reading sessions."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory()

    sdr_data = SdrReadingData(
        partial_md5="testmd5",
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={1705359000: 30, 1705359060: 25},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    counts = await import_sdr(db_session, book, sdr_data)
    assert counts["sessions"] == 1

    result = await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )
    sessions = result.scalars().all()
    assert len(sessions) == 1
    assert sessions[0].source == "sdr"
    assert sessions[0].pages_read == 55


async def test_import_sdr_no_duplicates(db_session, book_factory, shelf_factory):
    """Re-importing same .sdr doesn't duplicate sessions or highlights."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrAnnotation, SdrReadingData

    await shelf_factory()
    book = await book_factory()

    ann = SdrAnnotation(text="Hello", note=None, chapter=None, page=1, datetime=None)
    sdr_data = SdrReadingData(
        partial_md5="dup123",
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=0.5,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={1705359000: 10},
        total_time_in_sec=None,
        annotations=[ann],
        raw={},
    )

    await import_sdr(db_session, book, sdr_data)
    counts2 = await import_sdr(db_session, book, sdr_data)

    assert counts2["sessions"] == 0  # already imported
    assert counts2["highlights"] == 0  # already imported

    sess_result = await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )
    assert len(sess_result.scalars().all()) == 1

    hl_result = await db_session.execute(select(Highlight).where(Highlight.book_id == book.id))
    assert len(hl_result.scalars().all()) == 1


async def test_import_sdr_dismissed_stays_dismissed(db_session, book_factory, shelf_factory):
    """Dismissed session is not re-imported."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory()

    sdr_data = SdrReadingData(
        partial_md5="dism123",
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={1705359000: 10},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    # First import
    await import_sdr(db_session, book, sdr_data)

    # Dismiss the session
    result = await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )
    sess = result.scalar_one()
    sess.dismissed = True
    await db_session.commit()

    # Re-import
    counts2 = await import_sdr(db_session, book, sdr_data)
    assert counts2["sessions"] == 0  # skipped because source_key already exists

    # Session should still be dismissed
    result = await db_session.execute(
        select(ReadingSession).where(ReadingSession.book_id == book.id)
    )
    sessions = result.scalars().all()
    assert len(sessions) == 1
    assert sessions[0].dismissed is True


async def test_import_sdr_empty_performance_no_crash(db_session, book_factory, shelf_factory):
    """.sdr with empty performance_in_pages → no sessions, no crash."""
    from app.koreader.sdr_importer import import_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory()

    sdr_data = SdrReadingData(
        partial_md5=None,
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    counts = await import_sdr(db_session, book, sdr_data)
    assert counts["sessions"] == 0
    assert counts["highlights"] == 0


# ── find_book_for_sdr ─────────────────────────────────────────────────────────


async def test_find_book_for_sdr_by_file_path(tmp_path, db_session, book_factory, shelf_factory):
    """Match book by file path."""
    from app.koreader.sdr_importer import find_book_for_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory(file_path="my_book.epub")

    # Create a fake book file
    book_file = tmp_path / "my_book.epub"
    book_file.write_bytes(b"fake")
    sdr_folder = tmp_path / "my_book.epub.sdr"
    sdr_folder.mkdir()

    sdr_data = SdrReadingData(
        partial_md5=None,
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    found = await find_book_for_sdr(db_session, sdr_data, sdr_folder)
    assert found is not None
    assert found.id == book.id


async def test_find_book_for_sdr_by_partial_md5(db_session, book_factory, shelf_factory):
    """Match book by partial MD5."""
    from app.koreader.sdr_importer import find_book_for_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    book = await book_factory()
    # Set the MD5 hash on the book
    book.file_hash_md5 = "abc123def456789"
    await db_session.commit()

    sdr_data = SdrReadingData(
        partial_md5="abc123def456",  # partial match
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    # Use a non-existent sdr folder so path matching skips
    import pathlib

    sdr_folder = pathlib.Path("/tmp/nonexistent.epub.sdr")

    found = await find_book_for_sdr(db_session, sdr_data, sdr_folder)
    assert found is not None
    assert found.id == book.id


async def test_find_book_for_sdr_unknown(db_session, book_factory, shelf_factory):
    """Unknown book returns None."""
    from app.koreader.sdr_importer import find_book_for_sdr
    from app.koreader.sdr_reader import SdrReadingData

    await shelf_factory()
    await book_factory()

    sdr_data = SdrReadingData(
        partial_md5="zzzzzzz",
        doc_path=None,
        title="Unknown Title",
        authors="Unknown Author",
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )

    import pathlib

    sdr_folder = pathlib.Path("/tmp/missing.epub.sdr")
    found = await find_book_for_sdr(db_session, sdr_data, sdr_folder)
    assert found is None
