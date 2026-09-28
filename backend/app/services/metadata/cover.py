"""Cover image extraction from EPUB and PDF files."""

from __future__ import annotations

import io
import logging
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

log = logging.getLogger(__name__)

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
        from ebooklib import ITEM_COVER, ITEM_IMAGE, epub
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

    # Fallback: EPUB2 OPF <meta name="cover" content="item-id"/> pattern
    if not cover_data:
        cover_data = _epub2_opf_cover(str(file_path), book)

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


def _epub2_opf_cover(file_path: str, book: object) -> bytes | None:
    """
    Read the OPF directly from the zip to find EPUB2-style cover:
    <meta name="cover" content="<item-id>"/> in <metadata>, then look up
    that item-id in <manifest> to get the image href.
    """
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            # Locate the OPF file via META-INF/container.xml
            container_xml = zf.read("META-INF/container.xml")
            root = ET.fromstring(container_xml)
            ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
            rootfile = root.find(".//c:rootfile", ns)
            if rootfile is None:
                return None
            opf_path = rootfile.get("full-path", "")
            if not opf_path:
                return None

            opf_xml = zf.read(opf_path)
            opf_root = ET.fromstring(opf_xml)
            opf_ns = {"opf": "http://www.idpf.org/2007/opf"}

            # Find <meta name="cover" content="..."/>
            cover_id: str | None = None
            for meta in opf_root.findall(".//opf:metadata/opf:meta", opf_ns):
                if meta.get("name") == "cover":
                    cover_id = meta.get("content")
                    break
            # Also try without namespace prefix (some OPFs omit it)
            if cover_id is None:
                for meta in opf_root.findall(".//{http://www.idpf.org/2007/opf}meta"):
                    if meta.get("name") == "cover":
                        cover_id = meta.get("content")
                        break
            if cover_id is None:
                return None

            # Find manifest item with that id
            opf_dir = opf_path.rsplit("/", 1)[0] if "/" in opf_path else ""
            for item in opf_root.findall(".//{http://www.idpf.org/2007/opf}item"):
                if item.get("id") == cover_id:
                    href = item.get("href", "")
                    img_path = f"{opf_dir}/{href}" if opf_dir else href
                    try:
                        return zf.read(img_path)
                    except KeyError:
                        return None
    except Exception as e:
        log.debug("EPUB2 OPF cover extraction failed: %s", e)
        return None
    return None


def _save_as_jpeg(data: bytes, output_path: str | Path, max_size: int | None = None) -> None:
    """Convert image bytes to JPEG and save to output_path."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        if max_size and (img.width > max_size or img.height > max_size):
            img.thumbnail((max_size, max_size), Image.LANCZOS)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(str(output_path), "JPEG", quality=85, optimize=True)
    except Exception as e:
        raise CoverExtractionError(f"Failed to save cover image: {e}") from e


_COVER_ID = "shelfloom-cover"
_COVER_NAME = "shelfloom-cover.jpg"


def _opf_path(z: zipfile.ZipFile) -> str:
    container = ET.fromstring(z.read("META-INF/container.xml"))
    for el in container.iter():
        if el.tag.endswith("rootfile") and el.get("full-path"):
            return el.get("full-path")  # type: ignore[return-value]
    raise CoverExtractionError("No OPF file listed in META-INF/container.xml")


def _set_cover_in_opf(opf: str, href: str) -> str:
    """Point the OPF's cover at our image, leaving everything else as it was.

    Adds (or reuses) a manifest item with EPUB 3's ``cover-image`` property,
    removes that property from any other item, and sets EPUB 2's
    ``<meta name="cover">`` to it, so every reader finds the same cover.
    """
    import re

    # Drop cover-image from other items (keep their other properties).
    def strip_prop(m: re.Match) -> str:
        tag = m.group(0)
        if f'id="{_COVER_ID}"' in tag:
            return tag
        tag = re.sub(r"\s*\bcover-image\b", "", tag)
        return re.sub(r'\sproperties="\s*"', "", tag)

    opf = re.sub(r"<(?:\w+:)?item\b[^>]*\bproperties=\"[^\"]*\"[^>]*>", strip_prop, opf)

    if f'id="{_COVER_ID}"' not in opf:
        item = (
            f'<item id="{_COVER_ID}" href="{href}" media-type="image/jpeg" '
            'properties="cover-image"/>'
        )
        opf, n = re.subn(r"(</(?:\w+:)?manifest>)", item + r"\1", opf, count=1)
        if not n:
            raise CoverExtractionError("OPF has no manifest")

    meta = f'<meta name="cover" content="{_COVER_ID}"/>'
    opf, n = re.subn(
        r'<(?:\w+:)?meta\b[^>]*\bname="cover"[^>]*/?>(?:\s*</(?:\w+:)?meta>)?', meta, opf
    )
    if not n:
        opf, n = re.subn(r"(</(?:\w+:)?metadata>)", meta + r"\1", opf, count=1)
        if not n:
            raise CoverExtractionError("OPF has no metadata")
    return opf


def embed_epub_cover(epub_path: str | Path, cover_image_path: str | Path) -> None:
    """Make an image the EPUB's cover, changing as little of the file as possible.

    The image is added next to the OPF and only the OPF's cover entries are
    edited; every other file in the archive is copied byte for byte. The new
    EPUB is written to a temporary file and swapped in only once complete, so
    a failure never leaves a half-written book (which Syncthing would then
    copy to the e-reader).
    """
    import os
    import posixpath
    import tempfile

    epub_path = Path(epub_path)
    cover_data = Path(cover_image_path).read_bytes()
    try:
        with zipfile.ZipFile(epub_path) as src:
            opf_path = _opf_path(src)
            opf_dir = posixpath.dirname(opf_path)
            image_path = posixpath.join(opf_dir, _COVER_NAME) if opf_dir else _COVER_NAME
            opf = _set_cover_in_opf(src.read(opf_path).decode("utf-8"), _COVER_NAME)

            fd, tmp = tempfile.mkstemp(dir=epub_path.parent, suffix=".epub.tmp")
            os.close(fd)
            try:
                with zipfile.ZipFile(tmp, "w") as dst:
                    # mimetype must stay first and uncompressed.
                    if "mimetype" in src.namelist():
                        dst.writestr(
                            "mimetype", src.read("mimetype"), compress_type=zipfile.ZIP_STORED
                        )
                    for info in src.infolist():
                        if info.filename in ("mimetype", image_path):
                            continue
                        data = opf.encode("utf-8") if info.filename == opf_path else src.read(info)
                        dst.writestr(info, data, compress_type=info.compress_type)
                    dst.writestr(image_path, cover_data, compress_type=zipfile.ZIP_STORED)
                os.replace(tmp, epub_path)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
    except CoverExtractionError:
        raise
    except (OSError, KeyError, ET.ParseError, zipfile.BadZipFile, UnicodeDecodeError) as e:
        raise CoverExtractionError(f"Failed to write the cover into the EPUB: {e}") from e
