"""Cover image extraction from EPUB and PDF files."""
from __future__ import annotations

import io
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise ImportError("Pillow is required for cover extraction")


class CoverExtractionError(Exception):
    pass


def extract_epub_cover(file_path: str | Path, output_path: str | Path) -> bool:
    """
    Extract cover image from EPUB file.
    Returns True if a cover was extracted, False if none found.
    """
    try:
        from ebooklib import epub, ITEM_IMAGE, ITEM_COVER
    except ImportError:  # pragma: no cover
        raise CoverExtractionError("ebooklib is required")

    try:
        book = epub.read_epub(str(file_path), options={"ignore_ncx": True})
    except Exception as e:
        raise CoverExtractionError(f"Failed to open EPUB: {e}") from e

    cover_data: bytes | None = None

    # Try cover-type item first
    for item in book.get_items():
        if item.get_type() == ITEM_COVER:
            cover_data = item.get_content()
            break

    # Fallback: look for image items with "cover" in their name
    if not cover_data:
        for item in book.get_items():
            if item.get_type() == ITEM_IMAGE:
                name = (item.file_name or "").lower()
                if "cover" in name:
                    cover_data = item.get_content()
                    break

    if not cover_data:
        return False

    _save_as_jpeg(cover_data, output_path)
    return True


def extract_pdf_cover(file_path: str | Path, output_path: str | Path) -> bool:
    """Render the first page of a PDF as a cover image."""
    try:
        import fitz
    except ImportError:  # pragma: no cover
        raise CoverExtractionError("PyMuPDF is required")

    try:
        doc = fitz.open(str(file_path))
        if doc.page_count == 0:  # pragma: no cover
            doc.close()
            return False
        page = doc[0]
        mat = fitz.Matrix(1.0, 1.0)
        pix = page.get_pixmap(matrix=mat)
        img_data = pix.tobytes("jpeg")
        doc.close()
    except Exception as e:
        raise CoverExtractionError(f"Failed to render PDF page: {e}") from e

    _save_as_jpeg(img_data, output_path)
    return True


def _save_as_jpeg(data: bytes, output_path: str | Path) -> None:
    """Convert image bytes to JPEG and save to output_path."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(str(output_path), "JPEG", quality=85, optimize=True)
    except Exception as e:
        raise CoverExtractionError(f"Failed to save cover image: {e}") from e
