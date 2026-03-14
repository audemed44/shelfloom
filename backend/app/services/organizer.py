"""File organization engine: template resolution, safe move, rename logging."""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import nullslast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.organize import RenameLog
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf, ShelfTemplate
from app.services.hash_service import compute_hashes

_ILLEGAL = re.compile(r'[\\/:*?"<>|]')
_MAX_COMPONENT = 200
_DEFAULT_TEMPLATE = "{author}/{title}"


class FileOperationError(Exception):
    pass


class ShelfNotFound(Exception):
    pass


@dataclass
class OrganizerResult:
    book_id: str
    book_title: str
    old_path: str
    new_path: str
    moved: bool = False
    already_correct: bool = False
    error: str | None = None


# ── pure helpers ──────────────────────────────────────────────────────────────


def sanitize_component(name: str) -> str:
    """Remove illegal filename characters, collapse whitespace, and truncate."""
    sanitized = _ILLEGAL.sub("", name).strip()
    sanitized = re.sub(r"\s+", " ", sanitized)
    return sanitized[:_MAX_COMPONENT]


def format_sequence(seq: float, pad: int) -> str:
    """Zero-pad the integer part; preserve fractional part if non-integer."""
    if seq == int(seq):
        return str(int(seq)).zfill(pad)
    int_part = int(seq)
    frac_str = f"{seq:.10f}".rstrip("0").split(".")[1]
    return f"{str(int_part).zfill(pad)}.{frac_str}"


def resolve_template(
    template: str,
    book: Book,
    series_name: str,
    series_path: str,
    sequence: float | None,
    seq_pad: int = 2,
) -> str:
    """Resolve all template tokens to a sanitized relative file path."""
    # Sanitize individual token values (but NOT series_path — its "/" are dir separators)
    author = sanitize_component(book.author or "Unknown Author")
    title = sanitize_component(book.title)
    series_name_clean = sanitize_component(series_name)
    series_path_clean = "/".join(sanitize_component(p) for p in series_path.split("/")) if series_path else ""
    seq_str = format_sequence(sequence, seq_pad) if sequence is not None else ""

    raw = template
    # Strip {format} (and any preceding dot) — extension is always auto-appended
    raw = re.sub(r'\.?\{format\}', '', raw)
    # Conditional sequence token: {sequence|suffix} → "seq_strsuffix" if present, else ""
    raw = re.sub(
        r'\{sequence\|([^}]*)\}',
        lambda m: f"{seq_str}{m.group(1)}" if sequence is not None else "",
        raw,
    )
    raw = raw.replace("{author}", author)
    raw = raw.replace("{title}", title)
    raw = raw.replace("{series}", series_name_clean)
    raw = raw.replace("{series_path}", series_path_clean)
    raw = raw.replace("{sequence}", seq_str)
    raw = raw.replace("{isbn}", sanitize_component(book.isbn or ""))
    raw = raw.replace("{publisher}", sanitize_component(book.publisher or ""))
    raw = raw.replace("{language}", sanitize_component(book.language or ""))

    parts = [p.strip() for p in raw.split("/") if p.strip()]
    if not parts:
        return sanitize_component(book.title) + "." + book.format
    parts[-1] = parts[-1] + "." + book.format
    return "/".join(parts)


# ── file operations ───────────────────────────────────────────────────────────


def _safe_copy(src: Path, dst: Path) -> None:
    """Copy src → dst and verify SHA-256 matches; raise FileOperationError on mismatch."""
    src_sha, _ = compute_hashes(src)
    shutil.copy2(str(src), str(dst))
    dst_sha, _ = compute_hashes(dst)
    if src_sha != dst_sha:
        dst.unlink(missing_ok=True)
        raise FileOperationError(f"Hash mismatch after copy: {src} → {dst}")


def safe_move_with_sdr(src: Path, dst: Path) -> None:
    """Safe copy-verify-delete for a book file and its co-located .sdr folder."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    _safe_copy(src, dst)
    src_sdr = src.parent / (src.name + ".sdr")
    if src_sdr.is_dir():
        dst_sdr = dst.parent / (dst.name + ".sdr")
        shutil.copytree(str(src_sdr), str(dst_sdr))
        shutil.rmtree(str(src_sdr))
    src.unlink()


# ── DB queries ────────────────────────────────────────────────────────────────


async def _get_series_info(
    session: AsyncSession, book_id: str
) -> tuple[str, str, float | None]:
    """Return (series_name, series_path, sequence) for the book's primary series.

    series_path is the full hierarchy, e.g. "Cosmere/Stormlight Archive".
    Returns ("", "", None) if the book is not in any series.
    """
    result = await session.execute(
        select(BookSeries, Series)
        .join(Series, BookSeries.series_id == Series.id)
        .where(BookSeries.book_id == book_id)
        .order_by(nullslast(BookSeries.sequence.asc()))
        .limit(1)
    )
    row = result.first()
    if row is None:
        return "", "", None

    book_series, series = row

    # Walk up parent chain to build hierarchy path
    path_parts: list[str] = [series.name]
    current = series
    while current.parent_id is not None:
        parent_res = await session.execute(
            select(Series).where(Series.id == current.parent_id)
        )
        parent = parent_res.scalar_one_or_none()
        if parent is None:
            break
        path_parts.append(parent.name)
        current = parent

    path_parts.reverse()
    return series.name, "/".join(path_parts), book_series.sequence


async def _get_shelf_template(session: AsyncSession, shelf_id: int) -> tuple[str, int]:
    """Return (template_str, seq_pad) for a shelf, falling back to defaults."""
    result = await session.execute(
        select(ShelfTemplate).where(ShelfTemplate.shelf_id == shelf_id)
    )
    tmpl = result.scalar_one_or_none()
    if tmpl:
        return tmpl.template, tmpl.seq_pad
    return _DEFAULT_TEMPLATE, 2


# ── core organize logic ───────────────────────────────────────────────────────


async def organize_book(
    session: AsyncSession,
    book: Book,
    shelf: Shelf,
    template: str,
    seq_pad: int = 2,
    dry_run: bool = True,
) -> OrganizerResult:
    """Compute (and optionally execute) the target path for one book."""
    series_name, series_path, sequence = await _get_series_info(session, book.id)
    new_rel_path = resolve_template(
        template, book, series_name, series_path, sequence, seq_pad
    )

    result = OrganizerResult(
        book_id=book.id,
        book_title=book.title,
        old_path=book.file_path,
        new_path=new_rel_path,
    )

    if new_rel_path == book.file_path:
        result.already_correct = True
        return result

    if dry_run:
        return result

    shelf_root = Path(shelf.path)
    src = shelf_root / book.file_path
    dst = shelf_root / new_rel_path

    if not src.exists():
        result.error = f"Source file not found: {src}"
        return result

    try:
        safe_move_with_sdr(src, dst)
        log = RenameLog(
            book_id=book.id,
            shelf_id=shelf.id,
            template=template,
            old_path=book.file_path,
            new_path=new_rel_path,
        )
        session.add(log)
        book.file_path = new_rel_path
        await session.commit()
        result.moved = True
    except Exception as e:
        result.error = str(e)

    return result


async def organize_shelf(
    session: AsyncSession,
    shelf_id: int,
    template: str | None = None,
    seq_pad: int | None = None,
    dry_run: bool = True,
) -> list[OrganizerResult]:
    """Organize all books on a shelf. Returns a per-book result list."""
    shelf_result = await session.execute(select(Shelf).where(Shelf.id == shelf_id))
    shelf = shelf_result.scalar_one_or_none()
    if shelf is None:
        raise ShelfNotFound(f"Shelf {shelf_id} not found")

    shelf_template, shelf_pad = await _get_shelf_template(session, shelf_id)
    effective_template = template or shelf_template
    effective_pad = seq_pad if seq_pad is not None else shelf_pad

    books_result = await session.execute(select(Book).where(Book.shelf_id == shelf_id))
    books = list(books_result.scalars().all())

    results: list[OrganizerResult] = []
    for book in books:
        result = await organize_book(
            session, book, shelf, effective_template, effective_pad, dry_run
        )
        results.append(result)

    return results


async def list_rename_logs(
    session: AsyncSession,
    shelf_id: int | None = None,
    book_id: str | None = None,
    limit: int = 100,
) -> list[RenameLog]:
    query = select(RenameLog).order_by(RenameLog.created_at.desc()).limit(limit)
    if shelf_id is not None:
        query = query.where(RenameLog.shelf_id == shelf_id)
    if book_id is not None:
        query = query.where(RenameLog.book_id == book_id)
    result = await session.execute(query)
    return list(result.scalars().all())
