"""EPUB metadata extraction via ebooklib."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import ebooklib
    from ebooklib import epub
except ImportError:  # pragma: no cover
    raise ImportError("ebooklib is required for EPUB parsing")


SHELFLOOM_URN_PREFIX = "urn:shelfloom:"


class EPUBParseError(Exception):
    pass


@dataclass
class EPUBMetadata:
    title: str = "Unknown Title"
    author: str | None = None
    isbn: str | None = None
    publisher: str | None = None
    language: str | None = None
    description: str | None = None
    page_count: int | None = None
    series_name: str | None = None
    series_index: float | None = None
    epub_uid: str | None = None
    shelfloom_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def parse_epub(file_path: str | Path) -> EPUBMetadata:
    """Extract metadata from an EPUB file."""
    try:
        book = epub.read_epub(str(file_path), options={"ignore_ncx": True})
    except Exception as e:
        raise EPUBParseError(f"Failed to parse EPUB '{file_path}': {e}") from e

    meta = EPUBMetadata()
    raw: dict[str, Any] = {}

    # Title
    titles = book.get_metadata("DC", "title")
    if titles:
        meta.title = titles[0][0] or "Unknown Title"
        raw["titles"] = [t[0] for t in titles]

    # Author
    creators = book.get_metadata("DC", "creator")
    if creators:
        meta.author = creators[0][0]
        raw["creators"] = [c[0] for c in creators]

    # Publisher
    publishers = book.get_metadata("DC", "publisher")
    if publishers:
        meta.publisher = publishers[0][0]

    # Language
    languages = book.get_metadata("DC", "language")
    if languages:
        meta.language = languages[0][0]

    # Description
    descriptions = book.get_metadata("DC", "description")
    if descriptions:
        meta.description = descriptions[0][0]

    # Identifiers — look for ISBN and Shelfloom ID
    identifiers = book.get_metadata("DC", "identifier")
    for value, attrs in identifiers:
        if not value:
            continue
        v = str(value).strip()
        if v.startswith(SHELFLOOM_URN_PREFIX):
            meta.shelfloom_id = v[len(SHELFLOOM_URN_PREFIX) :]
        elif _looks_like_isbn(v):
            meta.isbn = _normalize_isbn(v)
        elif meta.epub_uid is None:
            meta.epub_uid = v
    raw["identifiers"] = [(v, a) for v, a in identifiers]

    # Page count estimate: count HTML/XHTML items
    html_items = [item for item in book.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT]
    if html_items:
        total_chars = sum(len(item.get_content()) for item in html_items)
        meta.page_count = max(1, total_chars // 2000)

    meta.raw = raw
    return meta


def _looks_like_isbn(value: str) -> bool:
    cleaned = re.sub(r"[-\s]", "", value)
    return bool(re.match(r"^(isbn:?)?(97[89])?\d{9}[\dxX]$", cleaned, re.IGNORECASE))


def _normalize_isbn(value: str) -> str:
    # Strip common prefixes
    v = re.sub(r"(?i)^urn:isbn:", "", value)
    v = re.sub(r"(?i)^isbn:", "", v)
    return v.strip()
