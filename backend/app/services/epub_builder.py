"""EPUB volume builder for web serial generated volumes."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from bs4 import BeautifulSoup
from ebooklib import epub

from app.models.serial import SerialChapter, SerialVolume, WebSerial

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


def _slugify(text: str) -> str:
    """Convert a title to a safe filesystem-friendly stem (max 80 chars)."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")[:80] or "untitled"


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


def _build_epub_sync(
    serial: WebSerial,
    volume: SerialVolume,
    chapters: list[SerialChapter],
    output_dir: Path,
) -> Path:
    """Synchronous EPUB construction — call via :func:`build_volume_epub`."""
    title = volume.name or f"{serial.title or 'Untitled'} - Volume {volume.volume_number}"
    author = serial.author or "Unknown"

    book = epub.EpubBook()

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

    # Build one XHTML item per chapter
    epub_chapters: list[epub.EpubHtml] = []
    toc: list[epub.Link] = []

    for ch in chapters:
        file_name = f"chapter_{ch.chapter_number:04d}.xhtml"
        ch_title = ch.title or f"Chapter {ch.chapter_number}"

        body_html = _clean_chapter_html(ch.content or "")
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
) -> Path:
    """Build an EPUB for *volume* and return the path to the generated file.

    Offloads the synchronous ebooklib work to a thread so the event loop
    stays unblocked.
    """
    return await asyncio.to_thread(_build_epub_sync, serial, volume, chapters, output_dir)
