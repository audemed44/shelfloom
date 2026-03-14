"""Tests for Book CRUD API."""

import uuid
from pathlib import Path

import pytest
from ebooklib import epub
from sqlalchemy import select

from app.models.book import Book
from app.models.shelf import Shelf
from app.models.tag import BookTag, Tag
from app.models.series import Series, BookSeries


FIXTURES = Path(__file__).parent / "fixtures"


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_epub(path: Path, title: str = "Book", author: str = "Author") -> Path:
    book = epub.EpubBook()
    book.set_identifier(f"id-{uuid.uuid4()}")
    book.set_title(title)
    book.add_author(author)
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = f"<p>{title}</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)
    return path


async def _create_shelf(
    db_session, tmp_path, name: str = "Shelf", is_default: bool = False
) -> Shelf:
    shelf = Shelf(name=name, path=str(tmp_path), is_default=is_default)
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _create_book(
    db_session, shelf_id: int, title: str = "Book", author: str = "A"
) -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        format="epub",
        file_path=f"{title}.epub",
        shelf_id=shelf_id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


# ── list ──────────────────────────────────────────────────────────────────────


async def test_list_books_empty(client):
    resp = await client.get("/api/books")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_list_books_pagination(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    for i in range(5):
        await _create_book(db_session, shelf.id, f"Book {i}")

    resp = await client.get("/api/books?page=1&per_page=3")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 3
    assert data["pages"] == 2


async def test_list_books_page_2(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    for i in range(5):
        await _create_book(db_session, shelf.id, f"Book {i}")

    resp = await client.get("/api/books?page=2&per_page=3")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 2


async def test_list_books_search_title(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    await _create_book(db_session, shelf.id, "Dune", "Frank Herbert")
    await _create_book(db_session, shelf.id, "Foundation", "Isaac Asimov")

    resp = await client.get("/api/books?search=Dune")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Dune"


async def test_list_books_search_author(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    await _create_book(db_session, shelf.id, "Dune", "Frank Herbert")
    await _create_book(db_session, shelf.id, "Foundation", "Isaac Asimov")

    resp = await client.get("/api/books?search=Herbert")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_list_books_filter_shelf(client, db_session, tmp_path):
    shelf1 = await _create_shelf(db_session, tmp_path, "Shelf1")
    shelf2 = await _create_shelf(db_session, tmp_path, "Shelf2")
    await _create_book(db_session, shelf1.id, "A")
    await _create_book(db_session, shelf2.id, "B")

    resp = await client.get(f"/api/books?shelf_id={shelf1.id}")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["title"] == "A"


async def test_list_books_filter_format(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    epub_book = Book(
        id=str(uuid.uuid4()),
        title="EPUB",
        format="epub",
        file_path="a.epub",
        shelf_id=shelf.id,
    )
    pdf_book = Book(
        id=str(uuid.uuid4()),
        title="PDF",
        format="pdf",
        file_path="b.pdf",
        shelf_id=shelf.id,
    )
    db_session.add(epub_book)
    db_session.add(pdf_book)
    await db_session.commit()

    resp = await client.get("/api/books?format=pdf")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["format"] == "pdf"


async def test_list_books_filter_tag(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Fantasy Book")
    tag = Tag(name="fantasy")
    db_session.add(tag)
    await db_session.flush()
    db_session.add(BookTag(book_id=book.id, tag_id=tag.id))
    await db_session.commit()

    resp = await client.get("/api/books?tag=fantasy")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_list_books_filter_series(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book1 = await _create_book(db_session, shelf.id, "Book 1")
    book2 = await _create_book(db_session, shelf.id, "Book 2")
    series = Series(name="My Series")
    db_session.add(series)
    await db_session.flush()
    db_session.add(BookSeries(book_id=book1.id, series_id=series.id, sequence=1))
    await db_session.commit()

    resp = await client.get(f"/api/books?series_id={series.id}")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["title"] == "Book 1"


# ── get ───────────────────────────────────────────────────────────────────────


async def test_get_book(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Test Book")

    resp = await client.get(f"/api/books/{book.id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Test Book"


async def test_get_book_not_found(client):
    resp = await client.get(f"/api/books/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── update ────────────────────────────────────────────────────────────────────


async def test_update_book_metadata(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Old Title")

    resp = await client.patch(
        f"/api/books/{book.id}",
        json={
            "title": "New Title",
            "author": "New Author",
            "publisher": "New Publisher",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "New Title"
    assert data["author"] == "New Author"
    assert data["publisher"] == "New Publisher"


async def test_update_book_not_found(client):
    resp = await client.patch(f"/api/books/{uuid.uuid4()}", json={"title": "X"})
    assert resp.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────


async def test_delete_book(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "ToDelete")

    resp = await client.delete(f"/api/books/{book.id}")
    assert resp.status_code == 204

    resp2 = await client.get(f"/api/books/{book.id}")
    assert resp2.status_code == 404


async def test_delete_book_not_found(client):
    resp = await client.delete(f"/api/books/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_book_with_file(client, db_session, tmp_path):
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    shelf = await _create_shelf(db_session, shelf_path)
    book_file = shelf_path / "todelete.epub"
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="FileBook",
        format="epub",
        file_path="todelete.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.delete(f"/api/books/{book.id}?delete_file=true")
    assert resp.status_code == 204
    assert not book_file.exists()


# ── upload ────────────────────────────────────────────────────────────────────


async def test_upload_invalid_format(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path, is_default=True)
    resp = await client.post(
        "/api/books",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400


async def test_upload_no_default_shelf(client):
    resp = await client.post(
        "/api/books",
        files={"file": ("book.epub", b"fake", "application/epub+zip")},
    )
    assert resp.status_code in (400, 409)


async def test_upload_epub(client, db_session, tmp_path):
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    shelf = await _create_shelf(db_session, shelf_path, is_default=True)

    epub_bytes = (FIXTURES / "test.epub").read_bytes()
    resp = await client.post(
        "/api/books",
        files={"file": ("test.epub", epub_bytes, "application/epub+zip")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["format"] == "epub"


# ── cover & download ──────────────────────────────────────────────────────────


async def test_cover_not_found(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "NoCover")

    resp = await client.get(f"/api/books/{book.id}/cover")
    assert resp.status_code == 404


async def test_cover_book_not_found(client):
    resp = await client.get(f"/api/books/{uuid.uuid4()}/cover")
    assert resp.status_code == 404


async def test_download_book(client, db_session, tmp_path):
    shelf_path = tmp_path / "shelf"
    shelf_path.mkdir()
    shelf = await _create_shelf(db_session, shelf_path)
    book_file = shelf_path / "download.epub"
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="DL",
        format="epub",
        file_path="download.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.get(f"/api/books/{book.id}/download")
    assert resp.status_code == 200
    assert "epub" in resp.headers["content-type"]


async def test_download_book_not_found(client):
    resp = await client.get(f"/api/books/{uuid.uuid4()}/download")
    assert resp.status_code == 404


# ── move ──────────────────────────────────────────────────────────────────────


async def test_move_book_between_shelves(client, db_session, tmp_path):
    src_path = tmp_path / "src"
    dst_path = tmp_path / "dst"
    src_path.mkdir()
    dst_path.mkdir()
    shelf1 = await _create_shelf(db_session, src_path, "Src")
    shelf2 = await _create_shelf(db_session, dst_path, "Dst")

    book_file = src_path / "move_me.epub"
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="Mover",
        format="epub",
        file_path="move_me.epub",
        shelf_id=shelf1.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf2.id})
    assert resp.status_code == 200
    assert resp.json()["shelf_id"] == shelf2.id
    assert (dst_path / "move_me.epub").exists()
    assert not (src_path / "move_me.epub").exists()


async def test_move_book_with_sdr(client, db_session, tmp_path):
    src_path = tmp_path / "src"
    dst_path = tmp_path / "dst"
    src_path.mkdir()
    dst_path.mkdir()
    shelf1 = await _create_shelf(db_session, src_path, "S1")
    shelf2 = await _create_shelf(db_session, dst_path, "S2")

    book_file = src_path / "sdr_book.epub"
    _make_epub(book_file)
    sdr_dir = src_path / "sdr_book.epub.sdr"
    sdr_dir.mkdir()
    (sdr_dir / "metadata.lua").write_text("return {}")

    book = Book(
        id=str(uuid.uuid4()),
        title="SDR",
        format="epub",
        file_path="sdr_book.epub",
        shelf_id=shelf1.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf2.id})
    assert resp.status_code == 200
    assert (dst_path / "sdr_book.epub.sdr").is_dir()
    assert not sdr_dir.exists()


async def test_move_book_same_shelf_noop(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Same")

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf.id})
    assert resp.status_code == 200  # no-op, just returns book


async def test_move_book_not_found(client):
    resp = await client.post(f"/api/books/{uuid.uuid4()}/move", json={"shelf_id": 1})
    assert resp.status_code == 404


async def test_move_book_non_sync_shelf_preserves_path(client, db_session, tmp_path):
    """Moving to a non-sync-target shelf keeps the original relative path."""
    src_path = tmp_path / "src"
    dst_path = tmp_path / "dst"
    src_path.mkdir()
    dst_path.mkdir()
    shelf1 = await _create_shelf(db_session, src_path, "Src")
    shelf2 = Shelf(name="Dst", path=str(dst_path), is_sync_target=False)
    db_session.add(shelf2)
    await db_session.commit()
    await db_session.refresh(shelf2)

    book_file = src_path / "subdir" / "my_book.epub"
    book_file.parent.mkdir()
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="My Book",
        author="Author",
        format="epub",
        file_path="subdir/my_book.epub",
        shelf_id=shelf1.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf2.id})
    assert resp.status_code == 200
    assert resp.json()["file_path"] == "subdir/my_book.epub"
    assert (dst_path / "subdir" / "my_book.epub").exists()


async def test_move_book_sync_shelf_applies_template(client, db_session, tmp_path):
    """Moving to a sync-target shelf applies the shelf's organization template."""
    from app.models.shelf import ShelfTemplate

    src_path = tmp_path / "src"
    dst_path = tmp_path / "dst"
    src_path.mkdir()
    dst_path.mkdir()
    shelf1 = await _create_shelf(db_session, src_path, "Src")
    shelf2 = Shelf(name="Sync", path=str(dst_path), is_sync_target=True)
    db_session.add(shelf2)
    await db_session.commit()
    await db_session.refresh(shelf2)

    # Set a simple template on the sync shelf
    tmpl = ShelfTemplate(
        shelf_id=shelf2.id, template="{author}/{title}.{format}", seq_pad=2
    )
    db_session.add(tmpl)
    await db_session.commit()

    book_file = src_path / "random_name.epub"
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="Great Book",
        author="Jane Doe",
        format="epub",
        file_path="random_name.epub",
        shelf_id=shelf1.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf2.id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_path"] == "Jane Doe/Great Book.epub"
    assert (dst_path / "Jane Doe" / "Great Book.epub").exists()
    assert not book_file.exists()


async def test_move_book_auto_organize_shelf_applies_template(
    client, db_session, tmp_path
):
    """Moving to an auto_organize shelf (not sync-target) also applies the template."""
    from app.models.shelf import ShelfTemplate

    src_path = tmp_path / "src"
    dst_path = tmp_path / "dst"
    src_path.mkdir()
    dst_path.mkdir()
    shelf1 = await _create_shelf(db_session, src_path, "Src2")
    shelf2 = Shelf(
        name="AutoOrg", path=str(dst_path), is_sync_target=False, auto_organize=True
    )
    db_session.add(shelf2)
    await db_session.commit()
    await db_session.refresh(shelf2)

    tmpl = ShelfTemplate(
        shelf_id=shelf2.id, template="{author}/{title}.{format}", seq_pad=2
    )
    db_session.add(tmpl)
    await db_session.commit()

    book_file = src_path / "orig.epub"
    _make_epub(book_file)
    book = Book(
        id=str(uuid.uuid4()),
        title="Auto Book",
        author="Test Author",
        format="epub",
        file_path="orig.epub",
        shelf_id=shelf1.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/move", json={"shelf_id": shelf2.id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_path"] == "Test Author/Auto Book.epub"
    assert (dst_path / "Test Author" / "Auto Book.epub").exists()


# ── refresh-cover ─────────────────────────────────────────────────────────────


async def test_refresh_cover_unknown_book(client):
    resp = await client.post("/api/books/no-such-id/refresh-cover")
    assert resp.status_code == 404


async def test_refresh_cover_file_missing(client, db_session, tmp_path):
    """Returns 422 when the book file is not on disk."""
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "NoCoverBook")
    resp = await client.post(f"/api/books/{book.id}/refresh-cover")
    assert resp.status_code == 422


async def test_refresh_cover_epub_no_cover_image(client, db_session, tmp_path):
    """EPUB without a cover image sets cover_path to null but returns 200."""
    shelf = await _create_shelf(db_session, tmp_path)
    book_file = tmp_path / "nocov.epub"
    _make_epub(book_file, "NoCov", "Writer")
    book = Book(
        id=str(uuid.uuid4()),
        title="NoCov",
        author="Writer",
        format="epub",
        file_path="nocov.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/refresh-cover")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cover_path"] is None


async def test_refresh_cover_epub_with_cover(client, db_session, tmp_path):
    """EPUB with a cover image extracts and sets cover_path."""
    from ebooklib import epub
    from PIL import Image
    import io

    shelf = await _create_shelf(db_session, tmp_path)
    book_file = tmp_path / "withcov.epub"

    eb = epub.EpubBook()
    eb.set_identifier(f"id-{uuid.uuid4()}")
    eb.set_title("WithCov")
    eb.add_author("Writer")
    # Create a tiny cover image
    img = Image.new("RGB", (60, 80), color=(100, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    cover_item = epub.EpubItem(
        uid="cover-img",
        file_name="cover.jpg",  # "cover" in name triggers fallback extractor
        media_type="image/jpeg",
        content=buf.getvalue(),
    )
    eb.add_item(cover_item)
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>hi</p>"
    eb.add_item(c1)
    eb.spine = ["nav", c1]
    eb.add_item(epub.EpubNcx())
    eb.add_item(epub.EpubNav())
    epub.write_epub(str(book_file), eb)

    book = Book(
        id=str(uuid.uuid4()),
        title="WithCov",
        author="Writer",
        format="epub",
        file_path="withcov.epub",
        shelf_id=shelf.id,
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.post(f"/api/books/{book.id}/refresh-cover")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cover_path"] is not None
