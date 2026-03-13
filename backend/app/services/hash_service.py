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
