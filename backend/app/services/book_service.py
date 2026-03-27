"""Book CRUD and search service."""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookHash
from app.models.shelf import Shelf
from app.schemas.book import BookUpdate
from app.services.hash_service import compute_hashes, koreader_partial_md5

log = logging.getLogger(__name__)


class BookNotFound(Exception):
    pass


class ShelfNotFound(Exception):
    pass


class FileOperationError(Exception):
    pass


async def _save_hash_record(
    session: AsyncSession,
    book: Book,
    sha: str,
    md5: str,
    md5_ko: str | None,
) -> None:
    """Persist a hash snapshot to book_hashes, deduplicating by SHA-256."""
    existing = await session.execute(
        select(BookHash).where(BookHash.book_id == book.id, BookHash.hash_sha == sha)
    )
    if existing.scalar_one_or_none() is None:
        session.add(
            BookHash(
                book_id=book.id,
                hash_sha=sha,
                hash_md5=md5,
                hash_md5_ko=md5_ko,
                page_count=book.page_count,
            )
        )


async def refresh_book_hashes(
    session: AsyncSession,
    book: Book,
    file_path: Path,
) -> bool:
    """
    Recompute all hashes for a book file after it has been modified and update
    the book record.  The previous hashes are saved to book_hashes first so
    that historical KOReader MD5 matching continues to work.

    Returns True if the file hash changed (i.e. the file was actually modified),
    False if it was unchanged.
    """
    new_sha, new_md5 = compute_hashes(file_path)
    if new_sha == book.file_hash:
        return False

    new_ko_md5 = koreader_partial_md5(file_path)

    # Preserve current hashes in history before overwriting
    if book.file_hash and book.file_hash_md5:
        await _save_hash_record(
            session, book, book.file_hash, book.file_hash_md5, book.file_hash_md5_ko
        )

    book.file_hash = new_sha
    book.file_hash_md5 = new_md5
    book.file_hash_md5_ko = new_ko_md5
    return True


async def list_books(
    session: AsyncSession,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
    shelf_id: int | None = None,
    format: str | None = None,
    tag: str | None = None,
    genre: str | None = None,
    author: str | None = None,
    series_id: int | None = None,
    status: str | None = None,
    sort: str = "created_at",
    filter_mode: str = "and",
) -> tuple[list[Book], int]:
    """Return (books, total_count)."""
    query = select(Book)

    if search:
        pattern = f"%{search}%"
        query = query.where(Book.title.ilike(pattern) | Book.author.ilike(pattern))
    if shelf_id is not None:
        query = query.where(Book.shelf_id == shelf_id)

    # Format filter — supports comma-separated values
    if format is not None:
        formats = [f.strip() for f in format.split(",") if f.strip()]
        if formats:
            query = query.where(Book.format.in_(formats))

    # Series filter — supports comma-separated IDs
    if series_id is not None:
        from app.models.series import BookSeries

        series_ids = [int(s.strip()) for s in str(series_id).split(",") if s.strip()]
        if series_ids:
            if filter_mode == "and":
                for sid in series_ids:
                    subq = select(BookSeries.book_id).where(
                        BookSeries.series_id == sid, BookSeries.book_id == Book.id
                    )
                    query = query.where(subq.exists())
            else:
                subq = select(BookSeries.book_id).where(
                    BookSeries.series_id.in_(series_ids),
                    BookSeries.book_id == Book.id,
                )
                query = query.where(subq.exists())

    # Tag filter — supports comma-separated IDs
    if tag is not None:
        from app.models.tag import BookTag

        tag_ids = [int(t.strip()) for t in tag.split(",") if t.strip()]
        if tag_ids:
            if filter_mode == "and":
                for tid in tag_ids:
                    subq = select(BookTag.book_id).where(
                        BookTag.tag_id == tid, BookTag.book_id == Book.id
                    )
                    query = query.where(subq.exists())
            else:
                subq = select(BookTag.book_id).where(
                    BookTag.tag_id.in_(tag_ids), BookTag.book_id == Book.id
                )
                query = query.where(subq.exists())

    # Genre filter — supports comma-separated IDs
    if genre is not None:
        from app.models.genre import BookGenre

        genre_ids = [int(g.strip()) for g in genre.split(",") if g.strip()]
        if genre_ids:
            if filter_mode == "and":
                for gid in genre_ids:
                    subq = select(BookGenre.book_id).where(
                        BookGenre.genre_id == gid, BookGenre.book_id == Book.id
                    )
                    query = query.where(subq.exists())
            else:
                subq = select(BookGenre.book_id).where(
                    BookGenre.genre_id.in_(genre_ids),
                    BookGenre.book_id == Book.id,
                )
                query = query.where(subq.exists())

    # Author filter — supports comma-separated names
    if author is not None:
        author_names = [a.strip() for a in author.split(",") if a.strip()]
        if author_names:
            query = query.where(Book.author.in_(author_names))

    if status is not None:
        from app.models.reading import ReadingProgress as RP

        progress_subq = (
            select(func.max(RP.progress))
            .where(RP.book_id == Book.id)
            .correlate(Book)
            .scalar_subquery()
        )
        if status == "completed":
            query = query.where(progress_subq >= 100)
        elif status == "reading":
            query = query.where(progress_subq > 0, progress_subq < 100)
        elif status == "unread":
            query = query.where(progress_subq.is_(None) | (progress_subq == 0))

    # Count
    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Sort
    offset = (page - 1) * per_page
    if sort == "title":
        query = query.order_by(Book.title)
    elif sort == "author":
        query = query.order_by(Book.author.nulls_last(), Book.title)
    elif sort == "series":
        from app.models.series import BookSeries as BS
        from app.models.series import Series as S

        query = query.outerjoin(BS, Book.id == BS.book_id).outerjoin(S, BS.series_id == S.id)
        query = query.order_by(S.name.nulls_last(), BS.sequence.nulls_last(), Book.title)
    elif sort == "last_read":
        from app.models.reading import ReadingSession as RS

        last_session_subq = (
            select(func.max(RS.start_time))
            .where(RS.book_id == Book.id, RS.dismissed == False)  # noqa: E712
            .correlate(Book)
            .scalar_subquery()
        )
        query = query.order_by(last_session_subq.desc().nulls_last(), Book.date_added.desc())
    else:  # created_at (default)
        query = query.order_by(Book.date_added.desc())

    query = query.offset(offset).limit(per_page)
    result = await session.execute(query)
    return result.scalars().all(), total  # type: ignore[return-value]


async def get_book(session: AsyncSession, book_id: str) -> Book:
    result = await session.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if book is None:
        raise BookNotFound(f"Book {book_id} not found")
    return book


async def get_book_series_memberships(session: AsyncSession, book_id: str) -> list[dict]:
    """Return series memberships for a book with prev/next navigation."""
    from app.models.series import BookSeries, Series

    rows = await session.execute(
        select(BookSeries, Series)
        .join(Series, BookSeries.series_id == Series.id)
        .where(BookSeries.book_id == book_id)
    )
    memberships = rows.all()

    result = []
    for bs, series in memberships:
        # All books in this series ordered by sequence (nulls last), then title
        sibs = await session.execute(
            select(BookSeries, Book)
            .join(Book, BookSeries.book_id == Book.id)
            .where(BookSeries.series_id == series.id)
            .order_by(BookSeries.sequence.nulls_last(), Book.title)
        )
        all_books = [(b, bk) for b, bk in sibs.all()]
        idx = next((i for i, (b, _) in enumerate(all_books) if b.book_id == book_id), None)
        prev_entry = all_books[idx - 1] if idx is not None and idx > 0 else None
        next_entry = all_books[idx + 1] if idx is not None and idx < len(all_books) - 1 else None
        result.append(
            {
                "series_id": series.id,
                "series_name": series.name,
                "sequence": bs.sequence,
                "prev_book": (
                    {
                        "id": prev_entry[1].id,
                        "title": prev_entry[1].title,
                        "sequence": prev_entry[0].sequence,
                    }
                    if prev_entry
                    else None
                ),
                "next_book": (
                    {
                        "id": next_entry[1].id,
                        "title": next_entry[1].title,
                        "sequence": next_entry[0].sequence,
                    }
                    if next_entry
                    else None
                ),
            }
        )
    return result


async def update_book(session: AsyncSession, book_id: str, data: BookUpdate) -> Book:
    book = await get_book(session, book_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(book, field, value)
    await session.commit()
    await session.refresh(book)
    return book


async def delete_book(session: AsyncSession, book_id: str, delete_file: bool = False) -> None:
    book = await get_book(session, book_id)
    if delete_file:
        shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
        shelf = shelf_result.scalar_one_or_none()
        if shelf:
            full_path = Path(shelf.path) / book.file_path
            if full_path.exists():
                full_path.unlink()
            # Remove .sdr folder if present
            sdr = full_path.parent / (full_path.name + ".sdr")
            if sdr.is_dir():
                shutil.rmtree(sdr)
    await session.delete(book)
    await session.commit()


async def refresh_book_cover(
    session: AsyncSession,
    book_id: str,
    covers_dir: str | Path,
) -> Book:
    """Re-extract the cover from the book file and update book.cover_path."""
    book = await get_book(session, book_id)

    shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
    shelf = shelf_result.scalar_one_or_none()
    if shelf is None:
        raise ShelfNotFound(f"Shelf {book.shelf_id} not found")

    full_path = Path(shelf.path) / book.file_path
    if not full_path.exists():
        raise FileOperationError(f"File not found: {full_path}")

    output = Path(covers_dir) / f"{book.id}.jpg"
    try:
        if book.format == "epub":
            from app.services.metadata.cover import extract_epub_cover

            success = extract_epub_cover(full_path, output)
        else:
            from app.services.metadata.cover import extract_pdf_cover

            success = extract_pdf_cover(full_path, output)
        book.cover_path = str(output) if success else None
    except Exception as e:
        raise FileOperationError(f"Cover extraction failed: {e}") from e

    await session.commit()
    await session.refresh(book)
    return book


async def upload_book_cover(
    session: AsyncSession,
    book_id: str,
    covers_dir: str | Path,
    image_data: bytes,
) -> Book:
    """Save an uploaded image as the book cover (max 1200 px), embed in EPUB if applicable."""
    from app.services.metadata.cover import (
        CoverExtractionError,
        _save_as_jpeg,
        embed_epub_cover,
    )

    book = await get_book(session, book_id)

    output = Path(covers_dir) / f"{book.id}.jpg"
    try:
        _save_as_jpeg(image_data, output, max_size=1200)
    except CoverExtractionError as e:
        raise FileOperationError(str(e)) from e

    book.cover_path = str(output)

    if book.format == "epub":
        shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
        shelf = shelf_result.scalar_one_or_none()
        if shelf:
            full_path = Path(shelf.path) / book.file_path
            if full_path.exists():
                try:
                    embed_epub_cover(full_path, output)
                    await refresh_book_hashes(session, book, full_path)
                except CoverExtractionError as e:
                    log.warning("Could not embed cover into EPUB %s: %s", full_path.name, e)

    await session.commit()
    await session.refresh(book)
    return book


async def backfill_covers(
    session: AsyncSession,
    covers_dir: str | Path,
) -> dict[str, int]:
    """
    Re-extract covers for all books that have no cover or a missing cover file.
    Returns {'refreshed': n, 'failed': n, 'skipped': n}.
    """
    result = await session.execute(select(Book))
    books = result.scalars().all()

    refreshed = 0
    failed = 0
    skipped = 0

    for book in books:
        # Skip if cover already exists on disk
        if book.cover_path and os.path.exists(book.cover_path):
            skipped += 1
            continue

        shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
        shelf = shelf_result.scalar_one_or_none()
        if shelf is None:
            failed += 1
            continue

        full_path = Path(shelf.path) / book.file_path
        if not full_path.exists():
            failed += 1
            continue

        output = Path(covers_dir) / f"{book.id}.jpg"
        try:
            if book.format == "epub":
                from app.services.metadata.cover import extract_epub_cover

                success = extract_epub_cover(full_path, output)
            else:
                from app.services.metadata.cover import extract_pdf_cover

                success = extract_pdf_cover(full_path, output)
            book.cover_path = str(output) if success else None
            refreshed += 1
        except Exception as e:
            log.warning("Cover backfill failed for %s: %s", book.id, e, exc_info=True)
            failed += 1

    await session.commit()
    return {"refreshed": refreshed, "failed": failed, "skipped": skipped}


async def move_book(
    session: AsyncSession,
    book_id: str,
    target_shelf_id: int,
) -> Book:
    """
    Move a book file to a different shelf (safe copy-verify-delete).

    If the destination shelf is a sync target, the shelf's organization
    template is applied to determine the destination path. Otherwise the
    book's existing relative path is preserved unchanged.
    """
    book = await get_book(session, book_id)
    if book.shelf_id == target_shelf_id:
        return book

    src_shelf_result = await session.execute(select(Shelf).where(Shelf.id == book.shelf_id))
    src_shelf = src_shelf_result.scalar_one_or_none()
    if src_shelf is None:
        raise ShelfNotFound(f"Source shelf {book.shelf_id} not found")

    dst_shelf_result = await session.execute(select(Shelf).where(Shelf.id == target_shelf_id))
    dst_shelf = dst_shelf_result.scalar_one_or_none()
    if dst_shelf is None:
        raise ShelfNotFound(f"Target shelf {target_shelf_id} not found")

    src_path = Path(src_shelf.path) / book.file_path

    # Resolve destination path: apply template for auto-organize or sync-target shelves
    if dst_shelf.auto_organize or dst_shelf.is_sync_target:
        from app.services.organizer import (
            _get_series_info,
            _get_shelf_template,
            resolve_template,
        )

        template, seq_pad = await _get_shelf_template(session, target_shelf_id)
        series_name, series_path, sequence = await _get_series_info(session, book.id)
        new_rel_path = resolve_template(template, book, series_name, series_path, sequence, seq_pad)
    else:
        new_rel_path = book.file_path

    dst_path = Path(dst_shelf.path) / new_rel_path
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    # Copy-verify-delete
    shutil.copy2(str(src_path), str(dst_path))
    if dst_path.stat().st_size != src_path.stat().st_size:
        dst_path.unlink()
        raise FileOperationError("File copy verification failed (size mismatch)")

    # Move .sdr if present
    src_sdr = src_path.parent / (src_path.name + ".sdr")
    if src_sdr.is_dir():
        dst_sdr = dst_path.parent / (dst_path.name + ".sdr")
        shutil.copytree(str(src_sdr), str(dst_sdr))
        shutil.rmtree(str(src_sdr))

    src_path.unlink()

    # Log rename if path changed (template was applied during move)
    if (dst_shelf.auto_organize or dst_shelf.is_sync_target) and new_rel_path != book.file_path:
        from app.models.organize import RenameLog

        session.add(
            RenameLog(
                book_id=book.id,
                shelf_id=target_shelf_id,
                template=template,
                old_path=book.file_path,
                new_path=new_rel_path,
            )
        )

    book.shelf_id = target_shelf_id
    book.file_path = new_rel_path
    await session.commit()
    await session.refresh(book)
    return book
