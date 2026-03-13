"""Embed a Shelfloom UUID into an EPUB's OPF metadata."""
from __future__ import annotations

import hashlib
import io
import re
import uuid
import zipfile
from pathlib import Path


SHELFLOOM_URN_PREFIX = "urn:shelfloom:"
_SHELFLOOM_ID_ATTR = 'id="shelfloom-id"'


class EmbedError(Exception):
    pass


def _compute_hashes(data: bytes) -> tuple[str, str]:
    """Return (sha256_hex, md5_hex) for the given bytes."""
    return (
        hashlib.sha256(data).hexdigest(),
        hashlib.md5(data).hexdigest(),
    )


def _find_opf_path(zf: zipfile.ZipFile) -> str:
    """Locate the OPF file path from META-INF/container.xml."""
    try:
        container = zf.read("META-INF/container.xml").decode("utf-8", errors="replace")
    except KeyError as e:
        raise EmbedError("Missing META-INF/container.xml") from e

    match = re.search(r'full-path=["\']([^"\']+\.opf)["\']', container, re.IGNORECASE)
    if not match:
        raise EmbedError("Could not find OPF path in container.xml")
    return match.group(1)


def _has_shelfloom_id(opf_content: str) -> str | None:
    """Return the existing Shelfloom UUID if already embedded, else None."""
    pattern = re.compile(
        rf'<dc:identifier[^>]*{re.escape(_SHELFLOOM_ID_ATTR)}[^>]*>'
        rf'\s*{re.escape(SHELFLOOM_URN_PREFIX)}([^<]+)\s*</dc:identifier>',
        re.IGNORECASE,
    )
    match = pattern.search(opf_content)
    if match:
        return match.group(1).strip()

    # Also check attribute in any order
    for m in re.finditer(r'<dc:identifier([^>]*)>([^<]*)</dc:identifier>', opf_content, re.IGNORECASE):
        attrs = m.group(1)
        value = m.group(2).strip()
        if 'shelfloom-id' in attrs and value.startswith(SHELFLOOM_URN_PREFIX):
            return value[len(SHELFLOOM_URN_PREFIX):]
    return None


def _inject_identifier(opf_content: str, book_uuid: str) -> str:
    """Insert a shelfloom dc:identifier before </metadata>."""
    tag = (
        f'\n    <dc:identifier id="shelfloom-id">'
        f'{SHELFLOOM_URN_PREFIX}{book_uuid}</dc:identifier>'
    )
    # Insert before closing </metadata>
    new_content, count = re.subn(
        r'(</metadata>)', tag + r'\n    \1', opf_content, count=1, flags=re.IGNORECASE
    )
    if count == 0:
        raise EmbedError("Could not find </metadata> tag in OPF")
    return new_content


def embed_shelfloom_id(
    file_path: str | Path,
    book_uuid: str | None = None,
) -> tuple[str, str, str, str]:
    """
    Embed a Shelfloom UUID into the EPUB's OPF metadata.

    If the file already has a Shelfloom ID, it is left unchanged.

    Returns:
        (book_uuid, old_sha256, old_md5, new_sha256, new_md5) — actually
        a 4-tuple: (book_uuid, old_sha, new_sha, new_md5)

    Actually returns (book_uuid, old_sha256, old_md5, new_sha256, new_md5)
    as a named 5-tuple-like tuple.

    Returns (book_uuid, pre_sha256, pre_md5, post_sha256, post_md5).
    """
    path = Path(file_path)
    if not path.exists():
        raise EmbedError(f"File not found: {file_path}")

    original_bytes = path.read_bytes()
    pre_sha, pre_md5 = _compute_hashes(original_bytes)

    try:
        zf_check = zipfile.ZipFile(io.BytesIO(original_bytes))
        opf_path = _find_opf_path(zf_check)
        opf_bytes = zf_check.read(opf_path)
        opf_content = opf_bytes.decode("utf-8", errors="replace")
        zf_check.close()
    except (zipfile.BadZipFile, KeyError) as e:
        raise EmbedError(f"Cannot read EPUB zip: {e}") from e

    # Check if already embedded
    existing_id = _has_shelfloom_id(opf_content)
    if existing_id:
        return existing_id, pre_sha, pre_md5, pre_sha, pre_md5

    # Generate new UUID if not provided
    if book_uuid is None:
        book_uuid = str(uuid.uuid4())

    # Inject identifier
    new_opf_content = _inject_identifier(opf_content, book_uuid)
    new_opf_bytes = new_opf_content.encode("utf-8")

    # Rebuild the zip
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as src, \
         zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            if item.filename == opf_path:
                dst.writestr(item, new_opf_bytes)
            else:
                dst.writestr(item, src.read(item.filename))

    new_bytes = output.getvalue()
    post_sha, post_md5 = _compute_hashes(new_bytes)

    # Write back to disk
    path.write_bytes(new_bytes)

    return book_uuid, pre_sha, pre_md5, post_sha, post_md5
