"""Tests for the file organization engine (Step 1.9)."""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models.book import Book
from app.models.organize import RenameLog
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf, ShelfTemplate
from app.services.organizer import (
    FileOperationError,
    _safe_copy,
    format_sequence,
    list_rename_logs,
    organize_book,
    organize_shelf,
    resolve_template,
    safe_move_with_sdr,
    sanitize_component,
)

# ── helpers ───────────────────────────────────────────────────────────────────


def _book(
    title: str = "The Way of Kings",
    author: str | None = "Brandon Sanderson",
    format: str = "epub",
    file_path: str = "book.epub",
    shelf_id: int = 1,
    isbn: str | None = None,
    publisher: str | None = None,
    language: str | None = None,
) -> Book:
    b = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        format=format,
        file_path=file_path,
        shelf_id=shelf_id,
        isbn=isbn,
        publisher=publisher,
        language=language,
    )
    return b


async def _make_shelf(db_session, tmp_path, name: str = "Library") -> Shelf:
    shelf = Shelf(name=name, path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _make_book(
    db_session,
    shelf_id: int,
    title: str = "Test Book",
    author: str | None = "Author",
    file_path: str | None = None,
    format: str = "epub",
) -> Book:
    fp = file_path or f"{title}.{format}"
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        format=format,
        file_path=fp,
        shelf_id=shelf_id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


async def _make_series(db_session, name: str, parent_id: int | None = None) -> Series:
    s = Series(name=name, parent_id=parent_id)
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _assign_series(
    db_session, book_id: str, series_id: int, sequence: float | None = None
) -> None:
    entry = BookSeries(book_id=book_id, series_id=series_id, sequence=sequence)
    db_session.add(entry)
    await db_session.commit()


# ── sanitize_component ────────────────────────────────────────────────────────


def test_sanitize_removes_illegal_chars():
    assert sanitize_component('Smith: "Books"') == "Smith Books"
    assert sanitize_component("Dir/Sub") == "DirSub"
    assert sanitize_component("A*B?C<D>E|F") == "ABCDEF"


def test_sanitize_collapses_whitespace():
    assert sanitize_component("  Hello   World  ") == "Hello World"


def test_sanitize_truncates_long_name():
    long = "A" * 300
    result = sanitize_component(long)
    assert len(result) == 200


def test_sanitize_empty():
    assert sanitize_component("") == ""
    assert sanitize_component("   ") == ""


# ── format_sequence ───────────────────────────────────────────────────────────


def test_format_sequence_integer():
    assert format_sequence(1, 2) == "01"
    assert format_sequence(10, 2) == "10"
    assert format_sequence(100, 2) == "100"  # no truncation
    assert format_sequence(1, 3) == "001"


def test_format_sequence_fractional():
    assert format_sequence(2.5, 2) == "02.5"
    assert format_sequence(1.1, 2) == "01.1"
    assert format_sequence(10.5, 2) == "10.5"


def test_format_sequence_integer_float():
    # 1.0 should be treated as integer
    assert format_sequence(1.0, 2) == "01"


# ── resolve_template ──────────────────────────────────────────────────────────


def test_resolve_all_tokens():
    book = _book(
        title="The Way of Kings",
        author="Brandon Sanderson",
        format="epub",
        isbn="1234",
        publisher="Tor",
        language="en",
    )
    result = resolve_template(
        "{author}/{series_path}/{sequence} - {title}.{format}",
        book,
        series_name="Stormlight Archive",
        series_path="Cosmere/Stormlight Archive",
        sequence=1.0,
        seq_pad=2,
    )
    assert result == "Brandon Sanderson/Cosmere/Stormlight Archive/01 - The Way of Kings.epub"


def test_resolve_no_series_drops_segment():
    book = _book()
    result = resolve_template(
        "{author}/{series_path}/{title}.{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    # Empty series_path → empty segment → dropped
    assert result == "Brandon Sanderson/The Way of Kings.epub"


def test_resolve_no_series_sequence_empty():
    book = _book()
    result = resolve_template(
        "{author}/{sequence} - {title}.{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    # sequence="" → " - The Way of Kings.epub" → stripped → "- The Way of Kings.epub"
    assert "The Way of Kings.epub" in result
    assert "{sequence}" not in result


def test_resolve_no_author_fallback():
    book = _book(author=None)
    result = resolve_template(
        "{author}/{title}.{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result.startswith("Unknown Author/")


def test_resolve_sanitizes_illegal_chars_in_metadata():
    book = _book(title="Book: A Story", author="Smith/Jones")
    result = resolve_template(
        "{author}/{title}.{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    # Colon and slash removed from title/author
    assert ":" not in result
    # author slash becomes extra dir separator or is sanitized
    assert "{author}" not in result
    assert "Book A Story.epub" in result


def test_resolve_series_path_hierarchy():
    book = _book()
    result = resolve_template(
        "{author}/{series_path}/{title}.{format}",
        book,
        series_name="Stormlight Archive",
        series_path="Cosmere/Stormlight Archive",
        sequence=None,
    )
    parts = result.split("/")
    assert "Cosmere" in parts
    assert "Stormlight Archive" in parts


def test_resolve_zero_padding():
    book = _book()
    result = resolve_template(
        "{sequence} - {title}.{format}",
        book,
        series_name="S",
        series_path="S",
        sequence=1,
        seq_pad=3,
    )
    assert result.startswith("001 - ")


def test_resolve_fractional_sequence():
    book = _book()
    result = resolve_template(
        "{sequence} - {title}.{format}",
        book,
        series_name="S",
        series_path="S",
        sequence=2.5,
        seq_pad=2,
    )
    assert result.startswith("02.5 - ")


def test_resolve_isbn_publisher_language():
    book = _book(isbn="978-1234", publisher="Tor", language="en")
    result = resolve_template(
        "{author}/{title} [{isbn}].{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert "978-1234" in result


def test_resolve_empty_template_fallback():
    book = _book(title="My Book")
    # If all tokens produce empty strings → fall back to title.format
    result = resolve_template(
        "{series_path}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result == "My Book.epub"


def test_resolve_format_auto_appended():
    book = _book(format="pdf")
    result = resolve_template(
        "{author}/{title}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result.endswith(".pdf")


def test_resolve_format_token_stripped_for_backward_compat():
    book = _book(format="epub")
    result = resolve_template(
        "{author}/{title}.{format}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result == "Brandon Sanderson/The Way of Kings.epub"


def test_resolve_conditional_sequence_with_sequence():
    book = _book()
    result = resolve_template(
        "{author}/{sequence| - }{title}",
        book,
        series_name="S",
        series_path="S",
        sequence=1,
        seq_pad=2,
    )
    assert result == "Brandon Sanderson/01 - The Way of Kings.epub"


def test_resolve_conditional_sequence_without_sequence():
    book = _book()
    result = resolve_template(
        "{author}/{sequence| - }{title}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result == "Brandon Sanderson/The Way of Kings.epub"


def test_resolve_conditional_sequence_full_template():
    book = _book()
    result = resolve_template(
        "{author}/{series_path}/{sequence| - }{title}",
        book,
        series_name="Stormlight Archive",
        series_path="Cosmere/Stormlight Archive",
        sequence=1,
        seq_pad=2,
    )
    assert result == "Brandon Sanderson/Cosmere/Stormlight Archive/01 - The Way of Kings.epub"


def test_resolve_conditional_sequence_full_template_no_series():
    book = _book()
    result = resolve_template(
        "{author}/{series_path}/{sequence| - }{title}",
        book,
        series_name="",
        series_path="",
        sequence=None,
    )
    assert result == "Brandon Sanderson/The Way of Kings.epub"


# ── _safe_copy ────────────────────────────────────────────────────────────────


def test_safe_copy_moves_file(tmp_path):
    src = tmp_path / "src.epub"
    src.write_bytes(b"book content")
    dst = tmp_path / "dst" / "src.epub"
    dst.parent.mkdir()
    _safe_copy(src, dst)
    assert dst.read_bytes() == b"book content"
    # source is NOT deleted by _safe_copy (only safe_move_with_sdr deletes it)
    assert src.exists()


def test_safe_copy_hash_mismatch_raises_and_preserves_source(tmp_path):
    src = tmp_path / "src.epub"
    src.write_bytes(b"original")
    dst = tmp_path / "dst.epub"

    with patch("app.services.organizer.compute_hashes") as mock_hash:
        mock_hash.side_effect = [("aaa", "x"), ("bbb", "y")]  # src != dst hash
        with pytest.raises(FileOperationError, match="Hash mismatch"):
            _safe_copy(src, dst)

    assert src.exists()
    assert not dst.exists()  # corrupted dst removed


# ── safe_move_with_sdr ────────────────────────────────────────────────────────


def test_safe_move_basic(tmp_path):
    src = tmp_path / "src.epub"
    src.write_bytes(b"book data")
    dst = tmp_path / "dest" / "src.epub"

    safe_move_with_sdr(src, dst)

    assert dst.read_bytes() == b"book data"
    assert not src.exists()


def test_safe_move_creates_parent_dirs(tmp_path):
    src = tmp_path / "book.epub"
    src.write_bytes(b"x")
    dst = tmp_path / "Author" / "Series" / "book.epub"

    safe_move_with_sdr(src, dst)

    assert dst.exists()
    assert not src.exists()


def test_safe_move_with_sdr(tmp_path):
    src = tmp_path / "book.epub"
    src.write_bytes(b"content")
    sdr = tmp_path / "book.epub.sdr"
    sdr.mkdir()
    (sdr / "metadata.lua").write_text("return {}")

    dst = tmp_path / "dest" / "book.epub"
    safe_move_with_sdr(src, dst)

    assert dst.exists()
    assert not src.exists()
    dst_sdr = tmp_path / "dest" / "book.epub.sdr"
    assert dst_sdr.is_dir()
    assert (dst_sdr / "metadata.lua").exists()
    assert not sdr.exists()


def test_safe_move_no_sdr(tmp_path):
    """Works fine when there is no .sdr folder."""
    src = tmp_path / "book.epub"
    src.write_bytes(b"content")
    dst = tmp_path / "out" / "book.epub"

    safe_move_with_sdr(src, dst)  # should not raise
    assert dst.exists()


# ── organize_book (service) ───────────────────────────────────────────────────


async def test_organize_book_dry_run(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(db_session, shelf.id, title="Dune", author="Frank Herbert")

    result = await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{title}.{format}",
        dry_run=True,
    )

    assert result.new_path == "Frank Herbert/Dune.epub"
    assert result.moved is False
    # File was not actually moved
    assert book.file_path == "Dune.epub"


async def test_organize_book_dry_run_does_not_move_file(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    # Create the actual file
    src = Path(shelf.path) / "Dune.epub"
    src.write_bytes(b"epub content")

    await organize_book(db_session, book, shelf, "{author}/{title}.{format}", dry_run=True)

    assert src.exists()  # not moved
    assert book.file_path == "Dune.epub"  # DB unchanged


async def test_organize_book_apply_moves_file(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    src = Path(shelf.path) / "Dune.epub"
    src.write_bytes(b"epub content")

    result = await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{title}.{format}",
        dry_run=False,
    )

    assert result.moved is True
    assert result.error is None
    expected_dst = Path(shelf.path) / "Frank Herbert" / "Dune.epub"
    assert expected_dst.exists()
    assert not src.exists()
    assert book.file_path == "Frank Herbert/Dune.epub"


async def test_organize_book_already_correct(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Frank Herbert/Dune.epub",
    )

    result = await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{title}.{format}",
        dry_run=False,
    )

    assert result.already_correct is True
    assert result.moved is False


async def test_organize_book_missing_source(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session, shelf.id, title="Ghost", author="Author", file_path="ghost.epub"
    )
    # No actual file on disk

    result = await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{title}.{format}",
        dry_run=False,
    )

    assert result.error is not None
    assert "not found" in result.error.lower()
    assert result.moved is False


async def test_organize_book_with_series(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="The Way of Kings",
        author="Brandon Sanderson",
        file_path="twok.epub",
    )
    src = Path(shelf.path) / "twok.epub"
    src.write_bytes(b"epub")

    cosmere = await _make_series(db_session, "Cosmere")
    stormlight = await _make_series(db_session, "Stormlight Archive", parent_id=cosmere.id)
    await _assign_series(db_session, book.id, stormlight.id, sequence=1.0)

    result = await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{series_path}/{sequence} - {title}.{format}",
        seq_pad=2,
        dry_run=False,
    )

    assert result.moved is True
    expected = "Brandon Sanderson/Cosmere/Stormlight Archive/01 - The Way of Kings.epub"
    assert result.new_path == expected
    assert (Path(shelf.path) / expected).exists()


async def test_organize_book_rename_log_recorded(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    (Path(shelf.path) / "Dune.epub").write_bytes(b"x")

    await organize_book(
        db_session,
        book,
        shelf,
        template="{author}/{title}.{format}",
        dry_run=False,
    )

    from sqlalchemy import select

    logs_result = await db_session.execute(select(RenameLog))
    logs = logs_result.scalars().all()
    assert len(logs) == 1
    assert logs[0].old_path == "Dune.epub"
    assert logs[0].new_path == "Frank Herbert/Dune.epub"
    assert logs[0].book_id == book.id


# ── organize_shelf ────────────────────────────────────────────────────────────


async def test_organize_shelf_bulk(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    books = []
    for i in range(3):
        b = await _make_book(
            db_session,
            shelf.id,
            title=f"Book {i}",
            author="Author",
            file_path=f"book{i}.epub",
        )
        (Path(shelf.path) / f"book{i}.epub").write_bytes(b"x")
        books.append(b)

    results = await organize_shelf(
        db_session,
        shelf.id,
        template="{author}/{title}.{format}",
        dry_run=False,
    )

    assert len(results) == 3
    assert all(r.moved for r in results)
    for i, b in enumerate(books):
        assert (Path(shelf.path) / "Author" / f"Book {i}.epub").exists()


async def test_organize_shelf_dry_run_no_files_moved(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    src = Path(shelf.path) / "Dune.epub"
    src.write_bytes(b"x")

    results = await organize_shelf(
        db_session,
        shelf.id,
        template="{author}/{title}.{format}",
        dry_run=True,
    )

    assert len(results) == 1
    assert results[0].moved is False
    assert src.exists()
    assert book.file_path == "Dune.epub"


async def test_organize_shelf_not_found(db_session):
    with pytest.raises(Exception, match="not found"):
        await organize_shelf(db_session, shelf_id=9999)


async def test_organize_shelf_uses_shelf_template(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    # Set per-shelf template
    tmpl = ShelfTemplate(shelf_id=shelf.id, template="{title}.{format}", seq_pad=2)
    db_session.add(tmpl)
    await db_session.commit()

    _book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )

    results = await organize_shelf(db_session, shelf.id, dry_run=True)
    # Should use shelf template, not default
    assert results[0].new_path == "Dune.epub"
    assert results[0].already_correct is True


async def test_organize_shelf_template_override(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    # Per-shelf template exists but caller overrides it
    tmpl = ShelfTemplate(shelf_id=shelf.id, template="{title}.{format}", seq_pad=2)
    db_session.add(tmpl)
    await db_session.commit()

    _book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    (Path(shelf.path) / "Dune.epub").write_bytes(b"x")

    results = await organize_shelf(
        db_session,
        shelf.id,
        template="{author}/{title}.{format}",  # override
        dry_run=False,
    )

    assert results[0].new_path == "Frank Herbert/Dune.epub"
    assert results[0].moved is True


# ── list_rename_logs ──────────────────────────────────────────────────────────


async def test_list_rename_logs(db_session, tmp_path):
    shelf = await _make_shelf(db_session, tmp_path)
    _book = await _make_book(
        db_session,
        shelf.id,
        title="Dune",
        author="Frank Herbert",
        file_path="Dune.epub",
    )
    (Path(shelf.path) / "Dune.epub").write_bytes(b"x")

    await organize_shelf(db_session, shelf.id, template="{author}/{title}.{format}", dry_run=False)

    logs = await list_rename_logs(db_session)
    assert len(logs) == 1
    assert logs[0].old_path == "Dune.epub"


async def test_list_rename_logs_filter_by_shelf(db_session, tmp_path):
    shelf1 = await _make_shelf(db_session, tmp_path / "s1", name="S1")
    (tmp_path / "s1").mkdir()
    shelf2 = await _make_shelf(db_session, tmp_path / "s2", name="S2")
    (tmp_path / "s2").mkdir()

    _book1 = await _make_book(db_session, shelf1.id, title="A", author="X", file_path="A.epub")
    (tmp_path / "s1" / "A.epub").write_bytes(b"x")
    _book2 = await _make_book(db_session, shelf2.id, title="B", author="Y", file_path="B.epub")
    (tmp_path / "s2" / "B.epub").write_bytes(b"x")

    await organize_shelf(db_session, shelf1.id, template="{author}/{title}.{format}", dry_run=False)
    await organize_shelf(db_session, shelf2.id, template="{author}/{title}.{format}", dry_run=False)

    logs = await list_rename_logs(db_session, shelf_id=shelf1.id)
    assert len(logs) == 1
    assert logs[0].shelf_id == shelf1.id


# ── API endpoints ─────────────────────────────────────────────────────────────


async def test_preview_endpoint(client, db_session, tmp_path):
    shelf = Shelf(name="TestShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(uuid.uuid4()),
        title="Dune",
        author="Frank Herbert",
        format="epub",
        file_path="Dune.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.get(
        f"/api/organize/preview?shelf_id={shelf.id}&template={{author}}/{{title}}.{{format}}"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["new_path"] == "Frank Herbert/Dune.epub"
    assert data[0]["moved"] is False


async def test_preview_endpoint_unknown_shelf(client):
    resp = await client.get("/api/organize/preview?shelf_id=9999")
    assert resp.status_code == 404


async def test_apply_endpoint(client, db_session, tmp_path):
    shelf = Shelf(name="ApplyShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(uuid.uuid4()),
        title="Dune",
        author="Frank Herbert",
        format="epub",
        file_path="Dune.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    # Create the actual file
    (tmp_path / "Dune.epub").write_bytes(b"epub content")

    resp = await client.post(
        "/api/organize/apply",
        json={"shelf_id": shelf.id, "template": "{author}/{title}.{format}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["moved"] is True
    assert (tmp_path / "Frank Herbert" / "Dune.epub").exists()


async def test_apply_endpoint_unknown_shelf(client):
    resp = await client.post("/api/organize/apply", json={"shelf_id": 9999})
    assert resp.status_code == 404


async def test_log_endpoint(client, db_session, tmp_path):
    shelf = Shelf(name="LogShelf", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)

    book = Book(
        id=str(uuid.uuid4()),
        title="Dune",
        author="Frank Herbert",
        format="epub",
        file_path="Dune.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()
    (tmp_path / "Dune.epub").write_bytes(b"x")

    # Apply first to create log entries
    await client.post(
        "/api/organize/apply",
        json={"shelf_id": shelf.id, "template": "{author}/{title}.{format}"},
    )

    resp = await client.get(f"/api/organize/log?shelf_id={shelf.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["old_path"] == "Dune.epub"
    assert data[0]["new_path"] == "Frank Herbert/Dune.epub"
