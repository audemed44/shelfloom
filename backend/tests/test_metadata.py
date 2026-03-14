"""Tests for EPUB/PDF metadata extraction and cover extraction."""

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
EPUB_PATH = FIXTURES / "test.epub"
PDF_PATH = FIXTURES / "test.pdf"


# ── EPUB parser ───────────────────────────────────────────────────────────────


async def test_parse_epub_basic():
    from app.services.metadata.epub import parse_epub

    meta = parse_epub(EPUB_PATH)
    assert meta.title == "Test Book Title"
    assert meta.author == "Test Author"
    assert meta.publisher == "Test Publisher"
    assert meta.language == "en"
    assert meta.description == "A test book description"


async def test_parse_epub_page_count():
    from app.services.metadata.epub import parse_epub

    meta = parse_epub(EPUB_PATH)
    assert meta.page_count is not None
    assert meta.page_count >= 1


async def test_parse_epub_uid():
    from app.services.metadata.epub import parse_epub

    meta = parse_epub(EPUB_PATH)
    # Our test EPUB has identifier 'test-epub-001'
    assert meta.epub_uid == "test-epub-001"


async def test_parse_epub_shelfloom_id_absent():
    from app.services.metadata.epub import parse_epub

    meta = parse_epub(EPUB_PATH)
    assert meta.shelfloom_id is None


async def test_parse_epub_shelfloom_id_present(tmp_path):
    """EPUB with a Shelfloom URN identifier — ID is extracted."""
    import uuid

    from ebooklib import epub

    from app.services.metadata.epub import SHELFLOOM_URN_PREFIX, parse_epub

    uid = str(uuid.uuid4())
    book = epub.EpubBook()
    book.set_title("ID Book")
    book.set_identifier("pub-id")
    book.add_metadata("DC", "identifier", f"{SHELFLOOM_URN_PREFIX}{uid}", {"id": "shelfloom-id"})
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>hi</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / "id_book.epub"
    epub.write_epub(str(path), book)

    meta = parse_epub(path)
    assert meta.shelfloom_id == uid


async def test_parse_epub_raw_metadata():
    from app.services.metadata.epub import parse_epub

    meta = parse_epub(EPUB_PATH)
    assert isinstance(meta.raw, dict)
    assert "titles" in meta.raw


async def test_parse_epub_missing_optional_fields(tmp_path):
    """EPUB with only title — optional fields fall back gracefully."""
    from ebooklib import epub

    from app.services.metadata.epub import parse_epub

    book = epub.EpubBook()
    book.set_title("Minimal Book")
    book.set_identifier("min-001")
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>hi</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / "minimal.epub"
    epub.write_epub(str(path), book)

    meta = parse_epub(path)
    assert meta.title == "Minimal Book"
    assert meta.author is None
    assert meta.publisher is None


async def test_parse_epub_malformed_file(tmp_path):
    from app.services.metadata.epub import EPUBParseError, parse_epub

    bad = tmp_path / "bad.epub"
    bad.write_bytes(b"this is not an epub file at all")
    with pytest.raises(EPUBParseError):
        parse_epub(bad)


async def test_parse_epub_isbn_extraction(tmp_path):
    from ebooklib import epub

    from app.services.metadata.epub import parse_epub

    book = epub.EpubBook()
    book.set_title("ISBN Book")
    book.set_identifier("main-id")
    book.add_metadata("DC", "identifier", "978-0-7653-2636-2", {"id": "isbn"})
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>hi</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / "isbn.epub"
    epub.write_epub(str(path), book)

    meta = parse_epub(path)
    assert meta.isbn is not None
    assert "978" in meta.isbn


# ── PDF parser ────────────────────────────────────────────────────────────────


async def test_parse_pdf_basic():
    from app.services.metadata.pdf import parse_pdf

    meta = parse_pdf(PDF_PATH)
    assert meta.title == "Test PDF Title"
    assert meta.author == "Test PDF Author"


async def test_parse_pdf_page_count():
    from app.services.metadata.pdf import parse_pdf

    meta = parse_pdf(PDF_PATH)
    assert meta.page_count == 1


async def test_parse_pdf_raw_metadata():
    from app.services.metadata.pdf import parse_pdf

    meta = parse_pdf(PDF_PATH)
    assert isinstance(meta.raw, dict)


async def test_parse_pdf_missing_metadata(tmp_path):
    """PDF without metadata — falls back to 'Unknown Title'."""
    import fitz

    from app.services.metadata.pdf import parse_pdf

    doc = fitz.open()
    doc.new_page()
    path = str(tmp_path / "empty_meta.pdf")
    doc.save(path)
    doc.close()

    meta = parse_pdf(path)
    assert meta.title == "Unknown Title"
    assert meta.author is None


async def test_parse_pdf_malformed_file(tmp_path):
    from app.services.metadata.pdf import PDFParseError, parse_pdf

    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"not a pdf")
    with pytest.raises(PDFParseError):
        parse_pdf(bad)


# ── filename parser ───────────────────────────────────────────────────────────


async def test_filename_author_dash_title():
    from app.services.metadata.filename import parse_filename

    meta = parse_filename("Brandon Sanderson - The Way of Kings.epub")
    assert meta.author == "Brandon Sanderson"
    assert meta.title == "The Way of Kings"


async def test_filename_title_only():
    from app.services.metadata.filename import parse_filename

    meta = parse_filename("just-a-title.epub")
    assert meta.title == "just a title"
    assert meta.author is None


async def test_filename_underscores():
    from app.services.metadata.filename import parse_filename

    meta = parse_filename("some_book_title.pdf")
    assert meta.author is None
    assert "some book title" in meta.title.lower()


# ── cover extraction ──────────────────────────────────────────────────────────


async def test_extract_pdf_cover(tmp_path):
    from app.services.metadata.cover import extract_pdf_cover

    output = tmp_path / "cover.jpg"
    result = extract_pdf_cover(PDF_PATH, output)
    assert result is True
    assert output.exists()
    assert output.stat().st_size > 0

    # Verify it's a valid JPEG
    from PIL import Image

    img = Image.open(output)
    assert img.format == "JPEG"


async def test_extract_epub_cover_no_cover(tmp_path):
    """EPUB without a cover image returns False."""
    from app.services.metadata.cover import extract_epub_cover

    output = tmp_path / "cover.jpg"
    result = extract_epub_cover(EPUB_PATH, output)
    # Our minimal test EPUB has no cover image
    assert result is False


async def test_extract_epub_cover_with_cover(tmp_path):
    """EPUB with a cover image — cover extracted successfully."""
    import io

    from ebooklib import epub
    from PIL import Image

    from app.services.metadata.cover import extract_epub_cover

    # Create an EPUB with a cover image
    book = epub.EpubBook()
    book.set_title("Covered Book")
    book.set_identifier("cov-001")

    # Create a small JPEG image as cover
    img_data = io.BytesIO()
    Image.new("RGB", (100, 150), color=(200, 100, 50)).save(img_data, "JPEG")
    # Use EpubImage for cover with "cover" in name
    cover_item = epub.EpubItem(
        uid="cover-image",
        file_name="images/cover.jpg",
        media_type="image/jpeg",
        content=img_data.getvalue(),
    )
    book.add_item(cover_item)

    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>hi</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub_path = tmp_path / "with_cover.epub"
    epub.write_epub(str(epub_path), book)

    output = tmp_path / "out_cover.jpg"
    result = extract_epub_cover(epub_path, output)
    assert result is True
    assert output.exists()


async def test_extract_cover_creates_parent_dirs(tmp_path):
    from app.services.metadata.cover import extract_pdf_cover

    output = tmp_path / "deep" / "nested" / "cover.jpg"
    result = extract_pdf_cover(PDF_PATH, output)
    assert result is True
    assert output.exists()


async def test_extract_epub_cover_bad_file(tmp_path):
    from app.services.metadata.cover import CoverExtractionError, extract_epub_cover

    bad = tmp_path / "bad.epub"
    bad.write_bytes(b"not an epub")
    with pytest.raises(CoverExtractionError):
        extract_epub_cover(bad, tmp_path / "out.jpg")


async def test_extract_pdf_cover_bad_file(tmp_path):
    from app.services.metadata.cover import CoverExtractionError, extract_pdf_cover

    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"not a pdf")
    with pytest.raises(CoverExtractionError):
        extract_pdf_cover(bad, tmp_path / "out.jpg")


async def test_save_as_jpeg_non_rgb(tmp_path):
    """RGBA image is converted to RGB before saving."""
    import io

    from PIL import Image

    from app.services.metadata.cover import _save_as_jpeg

    img_data = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 128)).save(img_data, "PNG")
    out = tmp_path / "out.jpg"
    _save_as_jpeg(img_data.getvalue(), out)
    assert out.exists()
    assert Image.open(out).mode == "RGB"


async def test_save_as_jpeg_invalid_data(tmp_path):
    from app.services.metadata.cover import CoverExtractionError, _save_as_jpeg

    with pytest.raises(CoverExtractionError):
        _save_as_jpeg(b"not image data", tmp_path / "out.jpg")
