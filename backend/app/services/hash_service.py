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

    Reads up to 12 chunks of 1024 bytes at offsets computed by LuaJIT's
    bit.lshift(1024, 2*i) for i in -1..10.  LuaJIT bit ops are 32-bit and
    mask the shift count to 5 bits ((2*i) & 31), so i=-1 gives shift=30 and
    (1024 << 30) & 0xFFFFFFFF = 0 (offset 0, i.e. start of file).
    Returns a lowercase hex string matching .sdr partial_md5_checksum and
    statistics.sqlite3 book.md5.
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
            # LuaJIT bit.lshift masks shift count to 5 bits before shifting
            shift = (2 * i) & 31
            offset = (step << shift) & 0xFFFFFFFF
            f.seek(offset)
            chunk = f.read(size)
            if not chunk:
                break
            md5.update(chunk)

    return md5.hexdigest()
