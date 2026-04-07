"""Tests for book import service and scanner."""

import hashlib
import shutil
import uuid
from pathlib import Path

from ebooklib import epub
from sqlalchemy import select

from app.models.book import Book, BookHash
from app.models.shelf import Shelf

FIXTURES = Path(__file__).parent / "fixtures"


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_epub(
    path: Path,
    title: str = "Book",
    author: str = "Author",
    cover_color: tuple[int, int, int] | None = None,
) -> Path:
    book = epub.EpubBook()
    book.set_identifier(f"id-{uuid.uuid4()}")
    book.set_title(title)
    book.add_author(author)
    if cover_color is not None:
        from io import BytesIO

        from PIL import Image

        img_data = BytesIO()
        Image.new("RGB", (100, 150), color=cover_color).save(img_data, "JPEG")
        cover_item = epub.EpubItem(
            uid="cover-image",
            file_name="images/cover.jpg",
            media_type="image/jpeg",
            content=img_data.getvalue(),
        )
        book.add_item(cover_item)
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


async def test_rescan_refreshes_cover_for_changed_file(tmp_path, db_session):
    from app.services.import_service import import_shelf

    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    book_path = shelf_path / "book.epub"
    _make_epub(book_path, "Covered Book", cover_color=(200, 40, 40))
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)

    book = await db_session.scalar(select(Book))
    assert book is not None
    assert book.cover_path is not None
    original_cover_bytes = Path(book.cover_path).read_bytes()

    _make_epub(book_path, "Covered Book", cover_color=(40, 40, 200))
    progress2 = await import_shelf(db_session, shelf, covers)

    assert progress2.updated == 1
    await db_session.refresh(book)
    assert book.cover_path is not None
    assert Path(book.cover_path).read_bytes() != original_cover_bytes


async def test_rescan_preserves_ui_metadata_edits(tmp_path, db_session):
    from app.schemas.book import BookUpdate
    from app.services.book_service import update_book
    from app.services.import_service import import_shelf

    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"
    book_path = shelf_path / "book.epub"
    _make_epub(book_path, "Original Title", "Original Author", cover_color=(20, 120, 20))
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    await import_shelf(db_session, shelf, covers)

    book = await db_session.scalar(select(Book))
    assert book is not None
    original_cover_path = book.cover_path

    await update_book(
        db_session,
        book.id,
        BookUpdate(title="Custom Title", author="Custom Author"),
    )

    _make_epub(book_path, "File Title", "File Author", cover_color=(120, 20, 120))
    progress2 = await import_shelf(db_session, shelf, covers)

    assert progress2.updated == 1
    await db_session.refresh(book)
    assert book.title == "Custom Title"
    assert book.author == "Custom Author"
    assert book.cover_path is not None
    assert book.cover_path == original_cover_path
    assert Path(book.cover_path).exists()


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
    from app.services.import_service import ImportProgress, import_shelf

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


# ── sdr + stats_db integration ────────────────────────────────────────────────


async def test_import_shelf_with_sdr_folder(tmp_path, db_session):
    """Full scan with .sdr folder present → reading data imported."""
    from app.models.reading import ReadingSession
    from app.services.import_service import import_shelf

    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"

    book_path = shelf_path / "book.epub"
    _make_epub(book_path, "Test Book", "Test Author")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    # Create .sdr folder with metadata
    sdr_dir = shelf_path / "book.epub.sdr"
    sdr_dir.mkdir()
    lua_content = """return {
        ["partial_md5_checksum"] = "test_sdr_md5",
        ["percent_finished"] = 0.5,
        ["doc_path"] = "/mnt/us/book.epub",
        ["doc_props"] = {
            ["title"] = "Test Book",
            ["authors"] = "Test Author",
        },
        ["stats"] = {
            ["performance_in_pages"] = {
                [1705359000] = 10,
                [1705359060] = 5,
            },
            ["total_time_in_sec"] = 900,
        },
        ["summary"] = { ["status"] = "reading" },
    }"""
    (sdr_dir / "metadata.epub.lua").write_text(lua_content)

    progress = await import_shelf(db_session, shelf, covers)

    assert progress.created == 1
    assert progress.sdr_imported >= 1  # at least 1 session imported
    assert progress.sdr_errors == []

    # Verify sessions in DB
    result = await db_session.execute(select(ReadingSession))
    sessions = result.scalars().all()
    assert len(sessions) >= 1
    assert sessions[0].source == "sdr"


async def test_import_shelf_with_stats_db(tmp_path, db_session):
    """stats_db_path passed → stats DB sessions imported."""
    import sqlite3

    from app.models.reading import ReadingSession
    from app.services.import_service import import_shelf

    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    covers = tmp_path / "covers"

    book_path = shelf_path / "book.epub"
    _make_epub(book_path, "Stats Book", "Stats Author")
    shelf = await _make_shelf_in_db(db_session, str(shelf_path))

    # First import the book
    progress = await import_shelf(db_session, shelf, covers)
    assert progress.created == 1

    # Get the imported book's MD5
    result = await db_session.execute(select(Book))
    book = result.scalar_one()

    # Create stats DB
    stats_db_path = tmp_path / "statistics.sqlite3"
    conn = sqlite3.connect(str(stats_db_path))
    conn.execute("""CREATE TABLE book (
        id INTEGER PRIMARY KEY, title TEXT, authors TEXT, md5 TEXT,
        series TEXT, language TEXT, total_read_time INTEGER,
        total_read_pages INTEGER, last_open INTEGER
    )""")
    conn.execute("""CREATE TABLE page_stat_data (
        id_book INTEGER, page INTEGER, start_time INTEGER,
        duration INTEGER, total_pages INTEGER
    )""")
    conn.execute(
        "INSERT INTO book VALUES (1, ?, ?, ?, NULL, NULL, 3600, 100, 1705000000)",
        (book.title, book.author, book.file_hash_md5),
    )
    conn.execute("INSERT INTO page_stat_data VALUES (1, 1, 1705359000, 120, 300)")
    conn.commit()
    conn.close()

    progress2 = await import_shelf(db_session, shelf, covers, stats_db_path=stats_db_path)

    assert progress2.sdr_imported >= 1
    assert progress2.sdr_errors == []

    result = await db_session.execute(select(ReadingSession))
    sessions = result.scalars().all()
    assert any(s.source == "stats_db" for s in sessions)


async def test_import_progress_has_sdr_fields(tmp_path, db_session):
    """ImportProgress dataclass has sdr_imported and sdr_errors fields."""
    from app.services.import_service import ImportProgress

    p = ImportProgress()
    assert hasattr(p, "sdr_imported")
    assert hasattr(p, "sdr_errors")
    assert p.sdr_imported == 0
    assert p.sdr_errors == []
