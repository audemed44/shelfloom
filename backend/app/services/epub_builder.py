"""EPUB volume builder for web serial generated volumes."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from ebooklib import epub

from app.models.serial import SerialChapter, SerialVolume, WebSerial

log = logging.getLogger(__name__)

SHELFLOOM_URN_PREFIX = "urn:shelfloom:"

_VOID_ELEMENTS = frozenset(
    [
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    ]
)

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
}


def _slugify(text: str) -> str:
    """Convert a title to a safe filesystem-friendly stem (max 80 chars)."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")[:80] or "untitled"


def _guess_media_type(url: str, content_type: str | None = None) -> str:
    """Guess image media type from URL extension or Content-Type header."""
    if content_type:
        ct = content_type.split(";")[0].strip().lower()
        if ct.startswith("image/"):
            return ct

    path = urlparse(url).path.lower()
    for ext, mt in _MEDIA_TYPES.items():
        if path.endswith(ext):
            return mt
    return "image/jpeg"


def _image_filename(url: str, index: int) -> str:
    """Generate a unique filename for an image based on URL hash."""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:10]
    path = urlparse(url).path.lower()
    ext = ".jpg"
    for candidate in _MEDIA_TYPES:
        if path.endswith(candidate):
            ext = candidate
            break
    return f"images/img_{index:04d}_{url_hash}{ext}"


def _clean_chapter_html(raw_html: str) -> str:
    """Normalize raw HTML to clean markup suitable for EPUB body content.

    - Strips ``<script>``, ``<style>``, and ``<nav>`` elements.
    - Self-closes void elements so the output is valid XHTML.
    """
    soup = BeautifulSoup(raw_html, "html.parser")

    for tag in soup.find_all(["script", "style", "nav"]):
        tag.decompose()

    html = str(soup)

    # Self-close void elements (e.g. <br> → <br/>)
    def _self_close(m: re.Match[str]) -> str:
        full = m.group(0)
        return full.rstrip(">").rstrip() + "/>"

    pattern = r"<(?:" + "|".join(_VOID_ELEMENTS) + r")(?:\s[^>]*)?" + r">"
    html = re.sub(pattern, _self_close, html, flags=re.IGNORECASE)

    return html


def _collect_image_urls(chapters: list[SerialChapter]) -> list[str]:
    """Extract all unique external image URLs from chapter HTML content."""
    seen: set[str] = set()
    urls: list[str] = []
    for ch in chapters:
        if not ch.content:
            continue
        soup = BeautifulSoup(ch.content, "html.parser")
        for img in soup.find_all("img", src=True):
            src = str(img["src"])
            if src.startswith(("http://", "https://")) and src not in seen:
                seen.add(src)
                urls.append(src)
    return urls


async def _download_images(
    urls: list[str],
) -> dict[str, tuple[str, bytes, str]]:
    """Download images and return a map of url → (epub_filename, data, media_type).

    Failures are logged and skipped — missing images won't break the build.
    """
    result: dict[str, tuple[str, bytes, str]] = {}
    if not urls:
        return result

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=20.0, limits=httpx.Limits(max_connections=5)
    ) as client:
        for i, url in enumerate(urls):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                content_type = resp.headers.get("content-type")
                media_type = _guess_media_type(url, content_type)
                filename = _image_filename(url, i)
                result[url] = (filename, resp.content, media_type)
            except Exception as exc:
                log.debug("Failed to download image %s: %s", url, exc)

    return result


def _rewrite_image_srcs(html_content: str, image_map: dict[str, tuple[str, bytes, str]]) -> str:
    """Replace external image URLs in HTML with local EPUB paths."""
    if not image_map:
        return html_content

    for url, (filename, _, _) in image_map.items():
        html_content = html_content.replace(url, filename)

    return html_content


def _build_epub_sync(
    serial: WebSerial,
    volume: SerialVolume,
    chapters: list[SerialChapter],
    output_dir: Path,
    existing_book_id: str | None = None,
    image_map: dict[str, tuple[str, bytes, str]] | None = None,
) -> Path:
    """Synchronous EPUB construction — call via :func:`build_volume_epub`."""
    title = volume.name or f"{serial.title or 'Untitled'} - Volume {volume.volume_number}"
    author = serial.author or "Unknown"

    book = epub.EpubBook()

    if existing_book_id:
        shelfloom_id = existing_book_id
    else:
        shelfloom_id = f"serial-{serial.id}-vol-{volume.volume_number}"
    book.set_identifier(f"{SHELFLOOM_URN_PREFIX}{shelfloom_id}")
    book.set_title(title)
    book.set_language("en")
    book.add_author(author)

    if serial.description:
        book.add_metadata("DC", "description", serial.description)

    # Publisher tag so readers display the app name
    book.add_metadata("DC", "publisher", "Shelfloom")

    # Cover image (volume-specific overrides serial cover)
    cover_path_str = volume.cover_path or serial.cover_path
    if cover_path_str:
        cover_file = Path(cover_path_str)
        if cover_file.exists():
            suffix = cover_file.suffix.lower()
            cover_name = f"cover{suffix}"
            book.set_cover(cover_name, cover_file.read_bytes(), create_page=False)

    # Embed downloaded images
    if image_map:
        for _url, (filename, data, media_type) in image_map.items():
            img_item = epub.EpubImage()
            img_item.file_name = filename
            img_item.media_type = media_type
            img_item.content = data
            book.add_item(img_item)

    # Build one XHTML item per chapter
    epub_chapters: list[epub.EpubHtml] = []
    toc: list[epub.Link] = []

    for ch in chapters:
        file_name = f"chapter_{ch.chapter_number:04d}.xhtml"
        ch_title = ch.title or f"Chapter {ch.chapter_number}"

        body_html = _clean_chapter_html(ch.content or "")
        if image_map:
            body_html = _rewrite_image_srcs(body_html, image_map)
        content = f"<h1>{ch_title}</h1>\n{body_html}"

        epub_ch = epub.EpubHtml(title=ch_title, file_name=file_name, lang="en")
        epub_ch.content = content
        book.add_item(epub_ch)
        epub_chapters.append(epub_ch)
        toc.append(epub.Link(file_name, ch_title, f"chapter-{ch.chapter_number}"))

    book.toc = toc
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav"] + epub_chapters

    slug = _slugify(title)
    out_path = output_dir / f"{slug}.epub"
    epub.write_epub(str(out_path), book)
    return out_path


async def build_volume_epub(
    serial: WebSerial,
    volume: SerialVolume,
    chapters: list[SerialChapter],
    output_dir: Path,
    existing_book_id: str | None = None,
) -> Path:
    """Build an EPUB for *volume* and return the path to the generated file.

    Downloads any external images referenced in chapter HTML and embeds them
    in the EPUB. Offloads the synchronous ebooklib work to a thread so the
    event loop stays unblocked.
    """
    # Download images before entering the sync builder
    image_urls = _collect_image_urls(chapters)
    image_map = await _download_images(image_urls)
    if image_map:
        log.info("Embedded %d images into EPUB for volume %d", len(image_map), volume.volume_number)

    return await asyncio.to_thread(
        _build_epub_sync, serial, volume, chapters, output_dir, existing_book_id, image_map
    )
