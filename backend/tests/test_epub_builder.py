"""Tests for the EPUB volume builder."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ebooklib import epub as ebooklib_epub

from app.services.epub_builder import (
    SHELFLOOM_URN_PREFIX,
    _clean_chapter_html,
    _collect_image_urls,
    _guess_media_type,
    _image_filename,
    _rewrite_image_srcs,
    _slugify,
    build_volume_epub,
)

# ---------------------------------------------------------------------------
# Helpers: build lightweight mock ORM objects (no DB required)
# ---------------------------------------------------------------------------


def _make_serial(
    *,
    id: int = 1,
    title: str = "My Story",
    author: str | None = "Author Name",
    description: str | None = None,
    cover_path: str | None = None,
    cover_url: str | None = None,
) -> MagicMock:
    s = MagicMock()
    s.id = id
    s.title = title
    s.author = author
    s.description = description
    s.cover_path = cover_path
    s.cover_url = cover_url
    return s


def _make_volume(
    *,
    id: int = 1,
    serial_id: int = 1,
    volume_number: int = 1,
    name: str | None = None,
    cover_path: str | None = None,
    chapter_start: int = 1,
    chapter_end: int = 3,
) -> MagicMock:
    v = MagicMock()
    v.id = id
    v.serial_id = serial_id
    v.volume_number = volume_number
    v.name = name
    v.cover_path = cover_path
    v.chapter_start = chapter_start
    v.chapter_end = chapter_end
    return v


def _make_chapter(number: int, title: str | None = None, content: str | None = None) -> MagicMock:
    ch = MagicMock()
    ch.chapter_number = number
    ch.title = title or f"Chapter {number}"
    ch.content = content or f"<p>Content of chapter {number}.</p>"
    return ch


# ---------------------------------------------------------------------------
# _slugify
# ---------------------------------------------------------------------------


def test_slugify_basic():
    assert _slugify("My Story - Volume 1") == "my-story-volume-1"


def test_slugify_special_chars():
    assert _slugify("A: B! C?") == "a-b-c"


def test_slugify_empty():
    assert _slugify("") == "untitled"


def test_slugify_truncates():
    long = "a" * 200
    assert len(_slugify(long)) <= 80


# ---------------------------------------------------------------------------
# _clean_chapter_html
# ---------------------------------------------------------------------------


def test_clean_chapter_html_removes_scripts():
    raw = "<p>Hello</p><script>alert(1)</script><p>World</p>"
    cleaned = _clean_chapter_html(raw)
    assert "<script>" not in cleaned
    assert "Hello" in cleaned
    assert "World" in cleaned


def test_clean_chapter_html_removes_style():
    raw = "<style>.x{color:red}</style><p>Text</p>"
    cleaned = _clean_chapter_html(raw)
    assert "<style>" not in cleaned
    assert "Text" in cleaned


def test_clean_chapter_html_removes_nav():
    raw = "<nav>Prev | Next</nav><p>Body</p>"
    cleaned = _clean_chapter_html(raw)
    assert "<nav>" not in cleaned
    assert "Body" in cleaned


def test_clean_chapter_html_self_closes_br():
    raw = "<p>Line one<br>Line two</p>"
    cleaned = _clean_chapter_html(raw)
    assert "<br/>" in cleaned or "<br />" in cleaned


def test_clean_chapter_html_self_closes_hr():
    raw = "<p>Before</p><hr><p>After</p>"
    cleaned = _clean_chapter_html(raw)
    assert "<hr/>" in cleaned or "<hr />" in cleaned


def test_clean_chapter_html_preserves_paragraphs():
    raw = "<p>First</p><p>Second</p>"
    cleaned = _clean_chapter_html(raw)
    assert "First" in cleaned
    assert "Second" in cleaned


# ---------------------------------------------------------------------------
# build_volume_epub — integration (writes a real EPUB to tmp_path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_volume_epub_creates_file(tmp_path):
    serial = _make_serial()
    volume = _make_volume()
    chapters = [_make_chapter(i) for i in range(1, 4)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    assert out.exists()
    assert out.suffix == ".epub"
    assert out.parent == tmp_path


@pytest.mark.asyncio
async def test_build_volume_epub_uses_volume_name(tmp_path):
    serial = _make_serial(title="Big Serial")
    volume = _make_volume(name="The Siege of Liscor")
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    titles = book.get_metadata("DC", "title")
    assert titles[0][0] == "The Siege of Liscor"


@pytest.mark.asyncio
async def test_build_volume_epub_fallback_title(tmp_path):
    serial = _make_serial(title="Big Serial")
    volume = _make_volume(volume_number=2, name=None)
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    titles = book.get_metadata("DC", "title")
    assert titles[0][0] == "Big Serial - Volume 2"


@pytest.mark.asyncio
async def test_build_volume_epub_author(tmp_path):
    serial = _make_serial(author="Jane Doe")
    volume = _make_volume()
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    creators = book.get_metadata("DC", "creator")
    assert any("Jane Doe" in c[0] for c in creators)


@pytest.mark.asyncio
async def test_build_volume_epub_shelfloom_identifier(tmp_path):
    serial = _make_serial(id=42)
    volume = _make_volume(volume_number=3)
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    identifiers = book.get_metadata("DC", "identifier")
    id_values = [v for v, _ in identifiers]
    assert any(v.startswith(SHELFLOOM_URN_PREFIX) for v in id_values)
    assert any("serial-42-vol-3" in v for v in id_values)


@pytest.mark.asyncio
async def test_build_volume_epub_no_cover(tmp_path):
    serial = _make_serial(cover_path=None)
    volume = _make_volume(cover_path=None)
    chapters = [_make_chapter(1)]

    # Should not raise even without a cover
    out = await build_volume_epub(serial, volume, chapters, tmp_path)
    assert out.exists()


@pytest.mark.asyncio
async def test_build_volume_epub_with_serial_cover(tmp_path):
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 100)  # minimal JPEG-like bytes

    serial = _make_serial(cover_path=str(cover))
    volume = _make_volume(cover_path=None)
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)
    assert out.exists()


@pytest.mark.asyncio
async def test_build_volume_epub_with_volume_cover_overrides(tmp_path):
    serial_cover = tmp_path / "serial_cover.jpg"
    serial_cover.write_bytes(b"\xff\xd8\xff" + b"\x00" * 50)

    vol_cover = tmp_path / "vol_cover.jpg"
    vol_cover.write_bytes(b"\xff\xd8\xff" + b"\x00" * 50)

    serial = _make_serial(cover_path=str(serial_cover))
    volume = _make_volume(cover_path=str(vol_cover))
    chapters = [_make_chapter(1)]

    # Should not raise; volume cover takes precedence
    out = await build_volume_epub(serial, volume, chapters, tmp_path)
    assert out.exists()


@pytest.mark.asyncio
async def test_build_volume_epub_cover_missing_file_is_skipped(tmp_path):
    serial = _make_serial(cover_path="/nonexistent/cover.jpg")
    volume = _make_volume(cover_path=None)
    chapters = [_make_chapter(1)]

    # Missing cover file should be silently ignored
    out = await build_volume_epub(serial, volume, chapters, tmp_path)
    assert out.exists()


@pytest.mark.asyncio
async def test_build_volume_epub_chapter_titles_in_toc(tmp_path):
    serial = _make_serial()
    volume = _make_volume()
    chapters = [
        _make_chapter(1, title="The Beginning"),
        _make_chapter(2, title="The Middle"),
        _make_chapter(3, title="The End"),
    ]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    toc_titles = {item.title for item in book.toc if hasattr(item, "title")}
    assert "The Beginning" in toc_titles
    assert "The End" in toc_titles


@pytest.mark.asyncio
async def test_build_volume_epub_fallback_chapter_title(tmp_path):
    serial = _make_serial()
    volume = _make_volume()
    chapters = [_make_chapter(7, title=None)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    toc_titles = {item.title for item in book.toc if hasattr(item, "title")}
    assert "Chapter 7" in toc_titles


@pytest.mark.asyncio
async def test_build_volume_epub_description(tmp_path):
    serial = _make_serial(description="An epic tale of adventure.")
    volume = _make_volume()
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    descs = book.get_metadata("DC", "description")
    assert any("epic tale" in d[0] for d in descs)


@pytest.mark.asyncio
async def test_build_volume_epub_empty_content_chapter(tmp_path):
    serial = _make_serial()
    volume = _make_volume()
    chapters = [_make_chapter(1, content=None)]

    # None content should not raise
    out = await build_volume_epub(serial, volume, chapters, tmp_path)
    assert out.exists()


@pytest.mark.asyncio
async def test_build_volume_epub_null_author(tmp_path):
    serial = _make_serial(author=None)
    volume = _make_volume()
    chapters = [_make_chapter(1)]

    out = await build_volume_epub(serial, volume, chapters, tmp_path)

    book = ebooklib_epub.read_epub(str(out))
    creators = book.get_metadata("DC", "creator")
    assert any("Unknown" in c[0] for c in creators)


# ---------------------------------------------------------------------------
# _guess_media_type
# ---------------------------------------------------------------------------


def test_guess_media_type_from_content_type():
    assert _guess_media_type("https://x.com/img", "image/png; charset=utf-8") == "image/png"


def test_guess_media_type_from_url_extension():
    assert _guess_media_type("https://x.com/photo.png") == "image/png"


def test_guess_media_type_default():
    assert _guess_media_type("https://x.com/img") == "image/jpeg"


def test_guess_media_type_non_image_content_type_falls_to_url():
    assert _guess_media_type("https://x.com/img.gif", "text/html") == "image/gif"


# ---------------------------------------------------------------------------
# _image_filename
# ---------------------------------------------------------------------------


def test_image_filename_includes_index_and_hash():
    name = _image_filename("https://example.com/pic.png", 5)
    assert name.startswith("images/img_0005_")
    assert name.endswith(".png")


def test_image_filename_default_extension():
    name = _image_filename("https://example.com/blob", 0)
    assert name.endswith(".jpg")


# ---------------------------------------------------------------------------
# _collect_image_urls
# ---------------------------------------------------------------------------


def test_collect_image_urls_extracts_http():
    ch1 = MagicMock()
    ch1.content = '<p><img src="https://img.com/a.png"/></p>'
    ch2 = MagicMock()
    ch2.content = '<p><img src="https://img.com/b.jpg"/></p>'

    urls = _collect_image_urls([ch1, ch2])
    assert urls == ["https://img.com/a.png", "https://img.com/b.jpg"]


def test_collect_image_urls_skips_relative():
    ch = MagicMock()
    ch.content = '<img src="/local/img.png"/>'
    assert _collect_image_urls([ch]) == []


def test_collect_image_urls_deduplicates():
    ch1 = MagicMock()
    ch1.content = '<img src="https://img.com/a.png"/>'
    ch2 = MagicMock()
    ch2.content = '<img src="https://img.com/a.png"/>'
    assert len(_collect_image_urls([ch1, ch2])) == 1


def test_collect_image_urls_skips_none_content():
    ch = MagicMock()
    ch.content = None
    assert _collect_image_urls([ch]) == []


# ---------------------------------------------------------------------------
# _rewrite_image_srcs
# ---------------------------------------------------------------------------


def test_rewrite_image_srcs():
    html = '<img src="https://img.com/a.png"/>'
    image_map = {"https://img.com/a.png": ("images/img_0000_abc.png", b"data", "image/png")}
    result = _rewrite_image_srcs(html, image_map)
    assert "images/img_0000_abc.png" in result
    assert "https://img.com/a.png" not in result


def test_rewrite_image_srcs_empty_map():
    html = '<img src="https://img.com/a.png"/>'
    assert _rewrite_image_srcs(html, {}) == html


# ---------------------------------------------------------------------------
# build_volume_epub with images
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_volume_epub_with_images(tmp_path):
    """EPUB embeds downloaded images and rewrites src attributes."""
    serial = _make_serial()
    volume = _make_volume()
    chapters = [
        _make_chapter(1, content='<p><img src="https://img.com/pic.png"/> text</p>'),
    ]

    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = fake_png
    mock_resp.headers = {"content-type": "image/png"}
    mock_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.epub_builder.httpx.AsyncClient", return_value=mock_client):
        out = await build_volume_epub(serial, volume, chapters, tmp_path)

    assert out.exists()
    book = ebooklib_epub.read_epub(str(out))
    image_items = [
        item
        for item in book.get_items()
        if item.media_type and item.media_type.startswith("image/")
    ]
    assert len(image_items) >= 1


@pytest.mark.asyncio
async def test_build_volume_epub_image_download_failure_skipped(tmp_path):
    """Failed image downloads are skipped — EPUB is still built."""
    serial = _make_serial()
    volume = _make_volume()
    chapters = [
        _make_chapter(1, content='<p><img src="https://img.com/broken.png"/> text</p>'),
    ]

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.epub_builder.httpx.AsyncClient", return_value=mock_client):
        out = await build_volume_epub(serial, volume, chapters, tmp_path)

    assert out.exists()
