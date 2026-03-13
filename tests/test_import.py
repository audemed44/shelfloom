"""Tests for book import service and scanner."""
import hashlib
import shutil
import uuid
from pathlib import Path

import pytest
from ebooklib import epub
from sqlalchemy import select

from app.models.book import Book, BookHash
from app.models.shelf import Shelf


FIXTURES = Path(__file__).parent / "fixtures"


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_epub(path: Path, title: str = "Book", author: str = "Author") -> Path:
    book = epub.EpubBook()
    book.set_identifier(f"id-{uuid.uuid4()}")
    book.set_title(title)
    book.add_author(author)
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = f"<p>{title} content. " + "word " * 50 + "</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)
    return path


def _make_pdf(path: Path, title: str = "PDF Book", author: str = "PDF Author") -> Path:
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), f"{title}", fontsize=14)
    doc.set_metadata({"title": title, "author": author})
    doc.save(str(path))
    doc.close()
    return path


async def _make_shelf_in_db(session, path: str) -> Shelf:
    shelf = Shelf(name=f"Shelf-{uuid.uuid4().hex[:6]}", path=path, is_default=False)
    session.add(shelf)
    await session.commit()
    await session.refresh(shelf)
    return shelf


# ── scanner ───────────────────────────────────────────────────────────────────

def test_discover_books_empty_dir(tmp_path):
    from app.services.scanner import discover_books
    assert discover_books(tmp_path) == []


def test_discover_books_nonexistent_dir(tmp_path):
    from app.services.scanner import discover_books
    assert discover_books(tmp_path / "nope") == []


def test_discover_books_finds_epub_and_pdf(tmp_path):
    from app.services.scanner import discover_books
    _make_epub(tmp_path / "a.epub")
    _make_pdf(tmp_path / "b.pdf")
    (tmp_path / "readme.txt").write_text("hi")
    found = discover_books(tmp_path)
    names = [p.name for p in found]
    assert "a.epub" in names
    assert "b.pdf" in names
    assert "readme.txt" not in names


def test_discover_books_recursive(tmp_path):
    from app.services.scanner import discover_books
    subdir = tmp_path / "sub"
    subdir.mkdir()
    _make_epub(subdir / "nested.epub")
    found = discover_books(tmp_path)
    assert any(p.name == "nested.epub" for p in found)


def test_discover_books_sorted(tmp_path):
    from app.services.scanner import discover_books
    _make_epub(tmp_path / "z.epub")
    _make_epub(tmp_path / "a.epub")
    found = discover_books(tmp_path)
    names = [p.name for p in found]
    assert names == sorted(names)


def test_find_sdr_folder_present(tmp_path):
    from app.services.scanner import find_sdr_folder
    book = tmp_path / "book.epub"
    book.write_bytes(b"fake")
    sdr = tmp_path / "book.epub.sdr"
    sdr.mkdir()
    result = find_sdr_folder(book)
    assert result == sdr


def test_find_sdr_folder_absent(tmp_path):
    from app.services.scanner import find_sdr_folder
    book = tmp_path / "book.epub"
    book.write_bytes(b"fake")
    assert find_sdr_folder(book) is None


# ── hash service ──────────────────────────────────────────────────────────────

def test_compute_hashes(tmp_path):
    from app.services.hash_service import compute_hashes
    data = b"hello world"
    f = tmp_path / "test.bin"
    f.write_bytes(data)
    sha, md5 = compute_hashes(f)
    assert sha == hashlib.sha256(data).hexdigest()
    assert md5 == hashlib.md5(data).hexdigest()


# ── import service ────────────────────────────────────────────────────────────

async def test_import_epub(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    _make_epub(shelf_path / "book.epub", "My Book", "My Author")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, covers)

    assert progress.created == 1
    assert progress.errors == []
    result = await db_session.execute(select(Book))
    books = result.scalars().all()
    assert len(books) == 1
    assert books[0].title == "My Book"
    assert books[0].author == "My Author"
    assert books[0].format == "epub"


async def test_import_pdf(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    _make_pdf(shelf_path / "doc.pdf", "My PDF", "PDF Author")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, covers)

    assert progress.created == 1
    result = await db_session.execute(select(Book))
    books = result.scalars().all()
    assert books[0].format == "pdf"
    assert books[0].title == "My PDF"


async def test_import_multiple_books(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    for i in range(5):
        _make_epub(shelf_path / f"epub{i}.epub", f"Book {i}")
    for i in range(2):
        _make_pdf(shelf_path / f"pdf{i}.pdf", f"PDF {i}")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, covers)

    assert progress.total == 7
    assert progress.created == 7
    result = await db_session.execute(select(Book))
    assert len(result.scalars().all()) == 7


async def test_import_ignores_non_book_files(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    (shelf_path / "notes.txt").write_text("notes")
    (shelf_path / "image.jpg").write_bytes(b"\xff\xd8\xff")
    _make_epub(shelf_path / "real.epub")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, tmp_path / "covers")
    assert progress.created == 1


async def test_import_empty_directory(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "empty"
    shelf_path.mkdir()
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, tmp_path / "covers")
    assert progress.total == 0
    assert progress.created == 0


async def test_rescan_no_duplicates(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    _make_epub(shelf_path / "book.epub")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)
    progress2 = await import_shelf(db_session, shelf, covers)

    assert progress2.created == 0
    result = await db_session.execute(select(Book))
    assert len(result.scalars().all()) == 1


async def test_rescan_detects_content_change(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    book_path = shelf_path / "book.epub"
    _make_epub(book_path, "Original Title")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)

    # Modify the file
    _make_epub(book_path, "Modified Title")
    progress2 = await import_shelf(db_session, shelf, covers)

    assert progress2.updated == 1
    result = await db_session.execute(select(Book))
    books = result.scalars().all()
    assert len(books) == 1  # no duplicate


async def test_import_records_hashes(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    _make_epub(shelf_path / "book.epub")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)

    result = await db_session.execute(select(BookHash))
    hashes = result.scalars().all()
    assert len(hashes) >= 1


async def test_import_progress_callback(tmp_path, db_session):
    from app.services.import_service import import_shelf, ImportProgress
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    for i in range(3):
        _make_epub(shelf_path / f"book{i}.epub", f"Book {i}")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    calls: list[ImportProgress] = []
    await import_shelf(db_session, shelf, tmp_path / "covers", progress_cb=calls.append)

    assert len(calls) >= 2  # at least initial + per-book callbacks
    assert calls[-1].processed == 3


async def test_import_malformed_file_skipped(tmp_path, db_session):
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    bad = shelf_path / "bad.epub"
    bad.write_bytes(b"not an epub file at all")
    _make_epub(shelf_path / "good.epub", "Good Book")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    progress = await import_shelf(db_session, shelf, covers)

    # Bad file logged as error, good book imported
    assert progress.created >= 1
    result = await db_session.execute(select(Book))
    books = result.scalars().all()
    assert any(b.title == "Good Book" for b in books)


async def test_import_shelfloom_id_reidentification(tmp_path, db_session):
    """Re-importing a moved EPUB with Shelfloom ID finds the existing record."""
    from app.services.import_service import import_shelf
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    _make_epub(shelf_path / "book.epub", "Stable Book")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)

    # "Move" the file by copying it with a different name and removing original
    shutil.copy(shelf_path / "book.epub", shelf_path / "renamed.epub")
    (shelf_path / "book.epub").unlink()

    progress2 = await import_shelf(db_session, shelf, covers)

    # Should update, not create a new book
    result = await db_session.execute(select(Book))
    books = result.scalars().all()
    assert len(books) == 1
    assert progress2.created == 0
