"""Book import orchestration: discover → hash → metadata → embed → DB."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookHash
from app.models.shelf import Shelf
from app.services.hash_service import compute_hashes
from app.services.scanner import discover_books

log = logging.getLogger(__name__)


@dataclass
class ImportProgress:
    total: int = 0
    processed: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


ProgressCallback = Callable[[ImportProgress], None]


async def import_shelf(
    session: AsyncSession,
    shelf: Shelf,
    covers_dir: str | Path,
    progress_cb: ProgressCallback | None = None,
    mtime_cache: dict[str, float] | None = None,
) -> ImportProgress:
    """
    Scan a shelf directory and import/update all books found.

    mtime_cache: if provided, files whose mtime is unchanged and already in the
    DB are skipped without re-hashing (incremental scan optimisation).
    """
    progress = ImportProgress()
    book_paths = discover_books(shelf.path)
    progress.total = len(book_paths)
    if progress_cb:
        progress_cb(progress)

    for book_path in book_paths:
        try:
            # Incremental skip: if mtime unchanged and book exists in DB
            cache_key = str(book_path)
            if mtime_cache is not None:
                current_mtime = book_path.stat().st_mtime
                if mtime_cache.get(cache_key) == current_mtime:
                    existing = await _find_by_path(session, shelf.id, book_path, shelf.path)
                    if existing is not None:
                        progress.skipped += 1
                        progress.processed += 1
                        if progress_cb:
                            progress_cb(progress)
                        continue

            action = await _process_file(session, shelf, book_path, covers_dir)

            # Update mtime cache after successful processing
            if mtime_cache is not None:
                mtime_cache[cache_key] = book_path.stat().st_mtime

            if action == "created":
                progress.created += 1
            elif action == "updated":
                progress.updated += 1
            else:
                progress.skipped += 1
        except Exception as e:
            log.error("Failed to import %s: %s", book_path, e)
            progress.errors.append(f"{book_path.name}: {e}")

        progress.processed += 1
        if progress_cb:
            progress_cb(progress)

    return progress


async def _process_file(
    session: AsyncSession,
    shelf: Shelf,
    book_path: Path,
    covers_dir: str | Path,
) -> str:
    """Import or update a single book file. Returns 'created'/'updated'/'skipped'."""
    fmt = book_path.suffix.lower().lstrip(".")
    if fmt not in ("epub", "pdf"):
        return "skipped"

    # Compute pre-embed hashes
    pre_sha, pre_md5 = compute_hashes(book_path)

    # Check by Shelfloom ID (EPUB only)
    if fmt == "epub":
        book = await _find_by_shelfloom_id(session, book_path)
        if book is None:
            book = await _find_by_hash(session, pre_sha, pre_md5)
    else:
        book = await _find_by_hash(session, pre_sha, pre_md5)

    # Also check by current path
    if book is None:
        book = await _find_by_path(session, shelf.id, book_path, shelf.path)

    if book is not None:
        # Existing book — check if content changed
        if book.file_hash == pre_sha:
            return "skipped"
        # Content changed — update hashes
        await _record_hash(session, book, pre_sha, pre_md5, None)
        book.file_hash = pre_sha
        book.file_hash_md5 = pre_md5
        book.file_path = str(book_path.relative_to(shelf.path))
        await session.commit()
        return "updated"

    # New book — extract metadata, embed ID (EPUB), save cover
    import uuid as _uuid
    book_uuid = str(_uuid.uuid4())
    book_path_str = str(book_path.relative_to(shelf.path))

    # Extract metadata
    title, author, publisher, language, description, page_count, epub_uid, metadata_raw = (
        _extract_metadata(book_path, fmt)
    )

    # Embed Shelfloom ID into EPUB
    post_sha, post_md5 = pre_sha, pre_md5
    if fmt == "epub":
        try:
            from app.services.metadata.embed import embed_shelfloom_id
            book_uuid, pre_sha, pre_md5, post_sha, post_md5 = embed_shelfloom_id(
                book_path, book_uuid=book_uuid
            )
        except Exception as e:
            log.warning("Could not embed Shelfloom ID into %s: %s", book_path.name, e)

    # Extract cover
    cover_path = _extract_cover(book_path, fmt, book_uuid, covers_dir)

    # Create book record
    book = Book(
        id=book_uuid,
        title=title,
        author=author,
        publisher=publisher,
        language=language,
        description=description,
        page_count=page_count,
        epub_uid=epub_uid,
        format=fmt,
        file_path=book_path_str,
        shelf_id=shelf.id,
        file_hash=post_sha,
        file_hash_md5=post_md5,
        file_size=book_path.stat().st_size,
        cover_path=cover_path,
        metadata_raw=json.dumps(metadata_raw),
    )
    session.add(book)
    await session.flush()  # get book.id

    # Record pre-embed hash (if different from post-embed)
    await _record_hash(session, book, pre_sha, pre_md5, page_count)
    if pre_sha != post_sha:
        await _record_hash(session, book, post_sha, post_md5, page_count)

    await session.commit()
    return "created"


async def _find_by_shelfloom_id(session: AsyncSession, book_path: Path) -> Book | None:
    """Check if this EPUB already has an embedded Shelfloom ID in the DB."""
    try:
        from app.services.metadata.epub import parse_epub
        meta = parse_epub(book_path)
        if meta.shelfloom_id:
            result = await session.execute(
                select(Book).where(Book.id == meta.shelfloom_id)
            )
            return result.scalar_one_or_none()
    except Exception:
        pass
    return None


async def _find_by_hash(session: AsyncSession, sha: str, md5: str) -> Book | None:
    # Check current hash
    result = await session.execute(
        select(Book).where(Book.file_hash == sha)
    )
    book = result.scalar_one_or_none()
    if book:
        return book
    # Check historical hashes
    result = await session.execute(
        select(Book).join(BookHash, Book.id == BookHash.book_id)
        .where(BookHash.hash_sha == sha)
    )
    return result.scalar_one_or_none()


async def _find_by_path(
    session: AsyncSession, shelf_id: int, book_path: Path, shelf_root: str
) -> Book | None:
    rel_path = str(book_path.relative_to(shelf_root))
    result = await session.execute(
        select(Book).where(Book.shelf_id == shelf_id, Book.file_path == rel_path)
    )
    return result.scalar_one_or_none()


async def _record_hash(
    session: AsyncSession, book: Book, sha: str, md5: str, page_count: int | None
) -> None:
    # Avoid duplicate hash records
    existing = await session.execute(
        select(BookHash).where(BookHash.book_id == book.id, BookHash.hash_sha == sha)
    )
    if existing.scalar_one_or_none() is None:
        session.add(BookHash(book_id=book.id, hash_sha=sha, hash_md5=md5, page_count=page_count))


def _extract_metadata(
    book_path: Path, fmt: str
) -> tuple[str, str | None, str | None, str | None, str | None, int | None, str | None, dict]:
    try:
        if fmt == "epub":
            from app.services.metadata.epub import parse_epub
            m = parse_epub(book_path)
            return (
                m.title, m.author, m.publisher, m.language,
                m.description, m.page_count, m.epub_uid, m.raw,
            )
        else:
            from app.services.metadata.pdf import parse_pdf
            from app.services.metadata.filename import parse_filename
            m = parse_pdf(book_path)
            if m.title == "Unknown Title":
                fn = parse_filename(book_path)
                m.title = fn.title
                if fn.author and not m.author:
                    m.author = fn.author
            return (m.title, m.author, m.publisher, m.language, m.description, m.page_count, None, m.raw)
    except Exception as e:
        log.warning("Metadata extraction failed for %s: %s", book_path.name, e)
        from app.services.metadata.filename import parse_filename
        fn = parse_filename(book_path)
        return fn.title, fn.author, None, None, None, None, None, {}


def _extract_cover(
    book_path: Path, fmt: str, book_uuid: str, covers_dir: str | Path
) -> str | None:
    output = Path(covers_dir) / f"{book_uuid}.jpg"
    try:
        if fmt == "epub":
            from app.services.metadata.cover import extract_epub_cover
            success = extract_epub_cover(book_path, output)
        else:
            from app.services.metadata.cover import extract_pdf_cover
            success = extract_pdf_cover(book_path, output)
        return str(output) if success else None
    except Exception as e:
        log.warning("Cover extraction failed for %s: %s", book_path.name, e)
        return None
