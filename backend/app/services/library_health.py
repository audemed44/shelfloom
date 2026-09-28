"""Library health check: problems worth fixing, and generated covers."""

from __future__ import annotations

import io
import logging
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import UnmatchedKOReaderEntry
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf
from app.services.cover_generator import render_cover, save_cover

log = logging.getLogger(__name__)

# Generated covers are saved under a recognisable name so they can be told
# apart from covers taken from the book or uploaded by the user.
GENERATED_SUFFIX = "-generated.jpg"
MAX_LISTED = 200


def is_generated_cover(cover_path: str | None) -> bool:
    return bool(cover_path) and str(cover_path).endswith(GENERATED_SUFFIX)


def _is_manual(book: Book) -> bool:
    return (book.file_path or "").startswith("manual://")


def _file_problem(path: Path, fmt: str | None) -> str | None:
    """Why a book file can't be read, or None if it looks fine."""
    try:
        if fmt == "epub":
            if not zipfile.is_zipfile(path):
                return "Not a valid EPUB (not a zip archive)"
            with zipfile.ZipFile(path) as z:
                names = set(z.namelist())
                if "META-INF/container.xml" not in names:
                    return "Not a valid EPUB (no META-INF/container.xml)"
                bad = z.testzip()
                if bad:
                    return f"Corrupt entry in the archive: {bad}"
        elif fmt == "pdf":
            with open(path, "rb") as f:
                if f.read(5) != b"%PDF-":
                    return "Not a valid PDF"
    except (OSError, zipfile.BadZipFile) as exc:
        return f"Could not be read: {exc}"
    return None


def _book_row(book: Book, detail: str | None = None) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "format": book.format,
        "cover_path": book.cover_path,
        "detail": detail,
    }


def _issue(
    key: str, severity: str, title: str, description: str, rows: list[dict], ok_title: str
) -> dict:
    return {
        "key": key,
        "severity": severity,
        "title": title,
        "ok_title": ok_title,
        "description": description,
        "count": len(rows),
        "books": rows[:MAX_LISTED],
    }


async def get_library_health(session: AsyncSession) -> dict:
    """Check every book and return the issues found, most serious first."""
    from app.services.data_mgmt_service import get_duplicate_book_groups

    rows = (await session.execute(select(Book, Shelf.path).join(Shelf))).all()
    missing, unreadable, no_cover, generated, no_author, no_fingerprint = [], [], [], [], [], []
    for book, shelf_path in sorted(rows, key=lambda r: (r[0].title or "").lower()):
        if not book.author or not book.author.strip():
            no_author.append(_book_row(book))
        if not book.cover_path or not Path(book.cover_path).exists():
            no_cover.append(_book_row(book))
        elif is_generated_cover(book.cover_path):
            generated.append(_book_row(book))
        if _is_manual(book):
            continue
        path = Path(shelf_path) / book.file_path
        if not path.exists():
            missing.append(_book_row(book, str(path)))
            continue
        problem = _file_problem(path, book.format)
        if problem:
            unreadable.append(_book_row(book, problem))
        elif not book.file_hash_md5_ko:
            no_fingerprint.append(_book_row(book))

    duplicate_groups = await get_duplicate_book_groups(session)
    unmatched = await session.scalar(
        select(func.count())
        .select_from(UnmatchedKOReaderEntry)
        .where(
            UnmatchedKOReaderEntry.dismissed == False,  # noqa: E712
            UnmatchedKOReaderEntry.linked_book_id.is_(None),
        )
    )

    issues = [
        _issue(
            "missing_file",
            "error",
            "Missing files",
            "The book is in the library but its file is gone from disk.",
            missing,
            "Every book's file is on disk",
        ),
        _issue(
            "unreadable_file",
            "error",
            "Unreadable files",
            "The file exists but isn't a valid EPUB or PDF.",
            unreadable,
            "Every file opens",
        ),
        _issue(
            "no_cover",
            "warning",
            "No cover",
            "No cover could be found in the file. Shelfloom can make one.",
            no_cover,
            "Every book has a cover",
        ),
        _issue(
            "no_fingerprint",
            "warning",
            "Not ready for KOReader sync",
            "The KOReader fingerprint was never recorded, so reading progress "
            "from KOReader can't be matched to these books.",
            no_fingerprint,
            "Every book is ready for KOReader sync",
        ),
        _issue(
            "no_author",
            "info",
            "No author",
            "Add the author so the book sorts and groups properly.",
            no_author,
            "Every book has an author",
        ),
        _issue(
            "generated_cover",
            "info",
            "Generated covers",
            "These books use a cover made by Shelfloom. Regenerate after changing "
            "the title, author or series.",
            generated,
            "No generated covers",
        ),
    ]
    links = [
        {
            "key": "duplicate_books",
            "severity": "warning",
            "title": "Possible duplicates",
            "count": sum(len(g["books"]) for g in duplicate_groups),
            "tab": "duplicate-books",
        },
        {
            "key": "unmatched",
            "severity": "warning",
            "title": "Unmatched KOReader data",
            "count": unmatched or 0,
            "tab": "unmatched",
        },
    ]
    return {
        "checked_at": datetime.now(UTC).replace(tzinfo=None),
        "total_books": len(rows),
        "issues": issues,
        "links": links,
    }


# ── fixes ─────────────────────────────────────────────────────────────────────


async def remove_missing_books(session: AsyncSession, book_ids: list[str]) -> int:
    """Delete library records whose file is gone. Books whose file exists are kept."""
    rows = (
        await session.execute(select(Book, Shelf.path).join(Shelf).where(Book.id.in_(book_ids)))
    ).all()
    removed = 0
    for book, shelf_path in rows:
        if _is_manual(book) or (Path(shelf_path) / book.file_path).exists():
            continue
        await session.delete(book)
        removed += 1
    await session.commit()
    return removed


async def record_missing_fingerprints(session: AsyncSession) -> int:
    """Compute the KOReader fingerprint for books that don't have one."""
    from app.services.hash_service import koreader_partial_md5

    rows = (
        await session.execute(
            select(Book, Shelf.path).join(Shelf).where(Book.file_hash_md5_ko.is_(None))
        )
    ).all()
    updated = 0
    for book, shelf_path in rows:
        if _is_manual(book):
            continue
        path = Path(shelf_path) / book.file_path
        if path.exists():
            book.file_hash_md5_ko = koreader_partial_md5(path)
            updated += book.file_hash_md5_ko is not None
    await session.commit()
    return updated


# ── generated covers ──────────────────────────────────────────────────────────


async def cover_inputs(session: AsyncSession, book: Book) -> dict:
    """Title, author and series (with the book's number) for a generated cover.

    Of a book's series, one where it has a number wins, and a sub-series (e.g.
    "The Stormlight Archive" inside "Cosmere") over its parent.
    """
    rows = (
        await session.execute(
            select(Series.name, Series.parent_id, BookSeries.sequence)
            .join(BookSeries, BookSeries.series_id == Series.id)
            .where(BookSeries.book_id == book.id)
        )
    ).all()
    best = None
    if rows:
        best = sorted(rows, key=lambda r: (r.sequence is None, r.parent_id is None))[0]
    return {
        "title": book.title,
        "author": book.author,
        "series": best.name if best else None,
        "sequence": best.sequence if best else None,
    }


async def preview_cover(session: AsyncSession, book_id: str) -> bytes:
    from app.services.book_service import get_book

    book = await get_book(session, book_id)
    img = render_cover(**await cover_inputs(session, book))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


async def generate_cover(
    session: AsyncSession, book_id: str, covers_dir: str | Path, *, embed: bool
) -> Book:
    """Make a cover for a book and use it; optionally write it into the EPUB too.

    Writing it into the EPUB changes the file, which is what makes the cover
    show on an e-reader. The book's old fingerprint is kept, so KOReader
    progress keeps syncing.
    """
    from app.services.book_service import get_book, refresh_book_hashes
    from app.services.metadata.cover import CoverExtractionError, embed_epub_cover

    book = await get_book(session, book_id)
    output = Path(covers_dir) / f"{book.id}{GENERATED_SUFFIX}"
    save_cover(render_cover(**await cover_inputs(session, book)), output)
    book.cover_path = str(output)

    if embed and book.format == "epub" and not _is_manual(book):
        shelf = await session.get(Shelf, book.shelf_id)
        path = Path(shelf.path) / book.file_path if shelf else None
        if path is not None and path.exists():
            try:
                embed_epub_cover(path, output)
                await refresh_book_hashes(session, book, path)
            except CoverExtractionError as exc:
                log.warning("Could not write the cover into %s: %s", path.name, exc)
    await session.commit()
    await session.refresh(book)
    return book


async def generate_covers(
    session: AsyncSession,
    covers_dir: str | Path,
    *,
    book_ids: list[str] | None,
    embed: bool,
) -> dict:
    """Generate covers for the given books, or for every book without one."""
    if book_ids is None:
        books = (await session.execute(select(Book))).scalars().all()
        book_ids = [b.id for b in books if not b.cover_path or not Path(b.cover_path).exists()]
    done = failed = 0
    for book_id in book_ids:
        try:
            await generate_cover(session, book_id, covers_dir, embed=embed)
            done += 1
        except Exception:  # noqa: BLE001 - one bad book shouldn't stop the batch
            log.exception("Could not generate a cover for %s", book_id)
            await session.rollback()
            failed += 1
    return {"generated": done, "failed": failed}
