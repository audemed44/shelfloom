"""Fallback metadata extraction from filename patterns."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class FilenameMetadata:
    title: str
    author: str | None = None


def parse_filename(file_path: str | Path) -> FilenameMetadata:
    """
    Try to extract author and title from the filename.

    Patterns:
    - "Author - Title.epub" → author="Author", title="Title"
    - "Title.epub" → title="Title"
    """
    stem = Path(file_path).stem

    # Match "Author - Title" pattern (dash with surrounding spaces required)
    match = re.match(r"^(.+?)\s+-\s+(.+)$", stem)
    if match:
        author = match.group(1).strip()
        title = match.group(2).strip()
        return FilenameMetadata(title=title, author=author)

    # Fallback: just the filename as title
    title = stem.replace("_", " ").replace("-", " ").strip()
    return FilenameMetadata(title=title or "Unknown Title")
