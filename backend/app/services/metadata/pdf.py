"""PDF metadata extraction via PyMuPDF (fitz)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import fitz
except ImportError:  # pragma: no cover
    raise ImportError("PyMuPDF (fitz) is required for PDF parsing")


class PDFParseError(Exception):
    pass


@dataclass
class PDFMetadata:
    title: str = "Unknown Title"
    author: str | None = None
    publisher: str | None = None
    language: str | None = None
    description: str | None = None
    page_count: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def parse_pdf(file_path: str | Path) -> PDFMetadata:
    """Extract metadata from a PDF file."""
    try:
        doc = fitz.open(str(file_path))
    except Exception as e:
        raise PDFParseError(f"Failed to open PDF '{file_path}': {e}") from e

    try:
        meta = PDFMetadata()
        pdf_meta = doc.metadata or {}
        meta.raw = dict(pdf_meta)

        title = (pdf_meta.get("title") or "").strip()
        meta.title = title if title else "Unknown Title"

        author = (pdf_meta.get("author") or "").strip()
        meta.author = author if author else None

        meta.page_count = doc.page_count
    finally:
        doc.close()

    return meta
