"""Directory walker for discovering book files."""

from __future__ import annotations

from pathlib import Path

BOOK_EXTENSIONS = {".epub", ".pdf"}


def discover_books(root: str | Path) -> list[Path]:
    """
    Recursively find all .epub and .pdf files under root.
    Returns a list of absolute Path objects, sorted by path.
    """
    root = Path(root)
    found: list[Path] = []
    if not root.is_dir():
        return found
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in BOOK_EXTENSIONS:
            found.append(path)
    return sorted(found)


def find_sdr_folder(book_path: Path) -> Path | None:
    """
    Return the .sdr folder next to a book file if it exists.
    E.g., /shelf/book.epub → /shelf/book.epub.sdr
    """
    sdr = book_path.parent / (book_path.name + ".sdr")
    return sdr if sdr.is_dir() else None
