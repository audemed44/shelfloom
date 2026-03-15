"""Compute SHA-256 and MD5 hashes for files."""

from __future__ import annotations

import hashlib
from pathlib import Path


def compute_hashes(file_path: str | Path) -> tuple[str, str]:
    """Return (sha256_hex, md5_hex) for the given file."""
    sha256 = hashlib.sha256()
    md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
            md5.update(chunk)
    return sha256.hexdigest(), md5.hexdigest()


def koreader_partial_md5(file_path: str | Path) -> str | None:
    """
    Replicate KOReader's util.partialMD5() from frontend/util.lua.

    Reads up to 12 chunks of 1024 bytes at geometrically increasing offsets
    (256, 1024, 4096, ..., up to 1 GB) and returns their combined MD5 as a
    lowercase hex string.  Matches the value stored in .sdr
    partial_md5_checksum and in statistics.sqlite3 book.md5.
    """
    try:
        f = open(file_path, "rb")  # noqa: WPS515
    except OSError:
        return None

    md5 = hashlib.md5()
    step = 1024
    size = 1024

    with f:
        for i in range(-1, 11):  # i = -1 .. 10
            shift = 2 * i
            if shift >= 0:
                offset = (step << shift) & 0xFFFFFFFF
            else:
                offset = (step >> (-shift)) & 0xFFFFFFFF
            f.seek(offset)
            chunk = f.read(size)
            if not chunk:
                break
            md5.update(chunk)

    return md5.hexdigest()
