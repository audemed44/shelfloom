#!/usr/bin/env python3
"""One-time import script: Booklore library → Shelfloom.

Two-phase approach:
  Phase 1 — Copy: epub/pdf files and their .sdr folders are copied from the
             Booklore export directory to the target shelf directory.
  Phase 2 — Scan: the existing import_shelf() service runs over the shelf,
             handling UUID embedding, page counts, cover extraction, and SDR
             reading-session import — exactly as a normal Shelfloom scan would.
  Phase 3 — Enrich: for each book now in the DB, the adjacent .metadata.json
             sidecar is read and used to patch curated title/author/publisher,
             series membership, and tags/categories.

Usage (run from backend/ with venv active):

    python scripts/import_booklore.py \\
        --source "C:/BookloreLibrary/books" \\
        --shelf-path "C:/Development/shelfloom/shelf" \\
        --shelf-name "Library" \\
        --db-path "C:/Development/shelfloom/shelfloom.db" \\
        --covers-dir "C:/Development/shelfloom/covers"

    # Skip copying — use source directory as the shelf (no file duplication):
    python scripts/import_booklore.py \\
        --source "C:/BookloreLibrary/books" \\
        --in-place \\
        --shelf-name "Library" \\
        --db-path "..." \\
        --covers-dir "..."

    # Preview phase 3 overrides without writing:
    python scripts/import_booklore.py ... --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import shutil
import sys
from pathlib import Path

# Add backend/ to sys.path so "from app.xxx" imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — registers all models with Base.metadata
from app.models.book import Book
from app.models.genre import BookGenre, Genre
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf
from app.models.tag import BookTag, Tag
from app.services.import_service import import_shelf

log = logging.getLogger(__name__)

SUPPORTED_FORMATS = {".epub", ".pdf"}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import a Booklore library export into Shelfloom")
    p.add_argument(
        "--source",
        required=True,
        help="Booklore books directory (e.g. C:/BookloreLibrary/books)",
    )
    p.add_argument(
        "--shelf-path",
        help="Target shelf directory (required unless --in-place)",
    )
    p.add_argument("--shelf-name", default="Library", help="Display name for the shelf")
    p.add_argument(
        "--db-path",
        default="./shelfloom.db",
        help="Shelfloom SQLite database file path",
    )
    p.add_argument(
        "--covers-dir",
        default="./covers",
        help="Directory where cover images are stored",
    )
    p.add_argument(
        "--stats-db",
        help="Path to a KOReader statistics.sqlite3 to import reading sessions from",
    )
    p.add_argument(
        "--in-place",
        action="store_true",
        help="Don't copy files; use the source directory as the shelf path directly",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run phases 1–2 normally but skip writing phase-3 metadata overrides",
    )
    p.add_argument("--verbose", "-v", action="store_true")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Phase 1: Copy files
# ---------------------------------------------------------------------------


def find_books(source: Path) -> list[Path]:
    return sorted(
        p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_FORMATS
    )


def strip_sequence_prefix(name: str) -> str:
    """Remove leading 'N. ' series-sequence prefix from a filename (e.g. '3. Foo.epub' → 'Foo.epub')."""  # noqa: E501
    import re

    return re.sub(r"^\d+\.\s+", "", name)


def copy_book_files(book_path: Path, target_root: Path) -> Path:
    """
    Copy book file + adjacent .sdr folder flat into target_root (no subfolders).
    Strips any leading sequence prefix (e.g. '3. ') from the destination filename.
    Returns the destination book path.
    """
    dest_name = strip_sequence_prefix(book_path.name)
    dest = target_root / dest_name
    target_root.mkdir(parents=True, exist_ok=True)

    if not dest.exists():
        shutil.copy2(book_path, dest)

    # Booklore names SDR folders as "<stem>.sdr" (without the .epub extension),
    # e.g. "Book (2023).sdr" — KOReader/Shelfloom expect "Book (2023).epub.sdr".
    sdr_src = book_path.parent / (book_path.stem + ".sdr")
    if sdr_src.is_dir():
        sdr_dest = target_root / (dest_name + ".sdr")
        if not sdr_dest.exists():
            shutil.copytree(sdr_src, sdr_dest)

    return dest


def phase1_copy(source: Path, shelf_path: Path) -> dict[str, Path]:
    """Copy all books and return a mapping of dest filename → original source path."""
    books = find_books(source)
    print(f"\n── Phase 1: Copying {len(books)} book(s) ──")
    source_map: dict[str, Path] = {}
    for i, book_path in enumerate(books, 1):
        rel = book_path.relative_to(source)
        print(f"  [{i}/{len(books)}] {rel}")
        dest = copy_book_files(book_path, shelf_path)
        source_map[dest.name] = book_path
    return source_map


# ---------------------------------------------------------------------------
# Phase 2: Scan (delegates entirely to existing import_shelf service)
# ---------------------------------------------------------------------------


async def phase2_scan(
    session: AsyncSession,
    shelf: Shelf,
    covers_dir: Path,
    stats_db_path: Path | None = None,
) -> None:
    label = "UUID embed, covers, page counts, SDR"
    if stats_db_path:
        label += ", stats DB"
    print(f"\n── Phase 2: Scanning shelf ({label}) ──")

    def progress_cb(p):
        print(
            f"\r  {p.processed}/{p.total} processed"
            f"  created={p.created} skipped={p.skipped} errors={len(p.errors)}",
            end="",
            flush=True,
        )

    result = await import_shelf(
        session=session,
        shelf=shelf,
        covers_dir=covers_dir,
        progress_cb=progress_cb,
        stats_db_path=stats_db_path,
    )
    print()  # newline after \r progress

    if result.errors:
        for e in result.errors:
            log.warning("Scan error: %s", e)
    print(
        f"  Done — created={result.created} updated={result.updated} "
        f"skipped={result.skipped} sdr_sessions={result.sdr_imported}"
    )
    if result.sdr_errors:
        for e in result.sdr_errors:
            log.warning("SDR error: %s", e)


# ---------------------------------------------------------------------------
# Phase 3: Enrich from .metadata.json sidecars
# ---------------------------------------------------------------------------


def read_sidecar(book_path: Path) -> dict | None:
    """Read Booklore's .metadata.json adjacent to the original source file."""
    sidecar = book_path.with_name(book_path.stem + ".metadata.json")
    if sidecar.exists():
        try:
            return json.loads(sidecar.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("Cannot read sidecar %s: %s", sidecar, e)
    return None


async def get_or_create_series(session: AsyncSession, name: str) -> Series:
    s = await session.scalar(select(Series).where(Series.name == name))
    if s is None:
        s = Series(name=name)
        session.add(s)
        await session.flush()
    return s


async def get_or_create_tag(session: AsyncSession, name: str) -> Tag:
    t = await session.scalar(select(Tag).where(Tag.name == name))
    if t is None:
        t = Tag(name=name)
        session.add(t)
        await session.flush()
    return t


async def get_or_create_genre(session: AsyncSession, name: str) -> Genre:
    g = await session.scalar(select(Genre).where(func.lower(Genre.name) == name.lower()))
    if g is None:
        g = Genre(name=name)
        session.add(g)
        await session.flush()
    return g


async def apply_sidecar_to_book(
    session: AsyncSession,
    book: Book,
    sidecar: dict,
    dry_run: bool,
) -> None:
    """Patch a DB book record with curated metadata from a Booklore sidecar."""
    m = sidecar.get("metadata", {})

    if dry_run:
        title = m.get("title") or book.title
        print(f"  [dry-run] Would enrich: {title!r}")
        return

    # Scalar fields — only override if sidecar has a non-empty value
    if m.get("title"):
        book.title = m["title"]
    authors = [a for a in (m.get("authors") or []) if a]
    if authors:
        book.author = ", ".join(authors)
    if m.get("publisher"):
        book.publisher = m["publisher"]
    if m.get("language"):
        book.language = m["language"]
    if m.get("description"):
        book.description = m["description"]
    if m.get("publishedDate"):
        book.date_published = m["publishedDate"]

    # Series — Booklore keeps one series per book
    series_data = m.get("series") or {}
    series_name = series_data.get("name") or ""
    if series_name:
        series = await get_or_create_series(session, series_name)
        # Only add if not already linked
        existing_link = await session.scalar(
            select(BookSeries).where(
                BookSeries.book_id == book.id,
                BookSeries.series_id == series.id,
            )
        )
        if existing_link is None:
            session.add(
                BookSeries(
                    book_id=book.id,
                    series_id=series.id,
                    sequence=series_data.get("number"),
                )
            )

    # Genres: Booklore's "categories" map to normalized genres.
    categories = [c for c in (m.get("categories") or []) if c]
    if categories:
        for genre_name in sorted({c.strip() for c in categories if c.strip()}, key=str.lower):
            genre = await get_or_create_genre(session, genre_name)
            existing_bg = await session.scalar(
                select(BookGenre).where(
                    BookGenre.book_id == book.id,
                    BookGenre.genre_id == genre.id,
                )
            )
            if existing_bg is None:
                session.add(BookGenre(book_id=book.id, genre_id=genre.id))

    # Tags: freeform labels only (e.g. "Web Serial", "Kindle Unlimited")
    all_tags = sorted({t for t in (m.get("tags") or []) if t})
    for tag_name in all_tags:
        tag = await get_or_create_tag(session, tag_name)
        existing_bt = await session.scalar(
            select(BookTag).where(BookTag.book_id == book.id, BookTag.tag_id == tag.id)
        )
        if existing_bt is None:
            session.add(BookTag(book_id=book.id, tag_id=tag.id))


async def phase3_enrich(
    session: AsyncSession,
    shelf: Shelf,
    source_map: dict[str, Path],
    dry_run: bool,
) -> None:
    """
    source_map: dest filename → original source path (built by phase1_copy).
    For --in-place runs, pass an identity map built from the source files.
    """
    print("\n── Phase 3: Enriching books from .metadata.json sidecars ──")

    books_result = await session.execute(select(Book).where(Book.shelf_id == shelf.id))
    books = books_result.scalars().all()

    enriched = 0
    missing_sidecar = 0

    for book in books:
        # book.file_path is the dest filename; look up the original source path
        dest_filename = Path(book.file_path).name
        source_book_path = source_map.get(dest_filename)
        if source_book_path is None:
            missing_sidecar += 1
            log.debug("No source mapping for %s", dest_filename)
            continue

        sidecar = read_sidecar(source_book_path)
        if sidecar is None:
            missing_sidecar += 1
            log.debug("No sidecar for %s", source_book_path)
            continue

        await apply_sidecar_to_book(session, book, sidecar, dry_run)
        enriched += 1

    if not dry_run:
        await session.commit()

    print(f"  Enriched={enriched}  no-sidecar={missing_sidecar}")
    if dry_run:
        print("  (dry-run — no changes written)")


# ---------------------------------------------------------------------------
# DB bootstrap
# ---------------------------------------------------------------------------


def _run_alembic_migrations(db_path: Path) -> None:
    """Apply Alembic migrations (sync). Creates alembic_version so the server
    startup auto-stamp path is never triggered."""
    from alembic.config import Config

    from alembic import command as alembic_command

    alembic_ini = Path(__file__).parent.parent / "alembic.ini"
    cfg = Config(str(alembic_ini))
    sync_url = f"sqlite:///{db_path}"
    cfg.set_main_option("sqlalchemy.url", sync_url)

    # Auto-stamp databases that existed before Alembic was added
    engine = create_engine(sync_url)
    with engine.connect() as conn:
        table_names = inspect(conn).get_table_names()
        if table_names and "alembic_version" not in table_names:
            alembic_command.stamp(cfg, "head")
    engine.dispose()

    alembic_command.upgrade(cfg, "head")


async def get_or_create_shelf(session: AsyncSession, name: str, path: str) -> Shelf:
    shelf = await session.scalar(select(Shelf).where(Shelf.path == path))
    if shelf is None:
        shelf = Shelf(
            name=name,
            path=path,
            is_default=True,
            is_sync_target=False,
            auto_organize=False,
        )
        session.add(shelf)
        await session.flush()
        await session.commit()
        log.info("Created shelf '%s' at %s", name, path)
    return shelf


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run(args: argparse.Namespace) -> None:
    source = Path(args.source).resolve()
    if not source.is_dir():
        sys.exit(f"ERROR: Source directory not found: {source}")

    if args.in_place:
        shelf_path = source
        print(
            "WARNING: --in-place will embed Shelfloom UUIDs directly into the EPUB files "
            "in the source directory. The originals will be modified. "
            "Press Ctrl+C to abort, or Enter to continue."
        )
        input()
    else:
        if not args.shelf_path:
            sys.exit("ERROR: --shelf-path is required unless --in-place is set")
        shelf_path = Path(args.shelf_path).resolve()

    covers_dir = Path(args.covers_dir).resolve()
    stats_db_path: Path | None = None
    if args.stats_db:
        stats_db_path = Path(args.stats_db).resolve()
        if not stats_db_path.is_file():
            sys.exit(f"ERROR: stats DB not found: {stats_db_path}")
    db_path = Path(args.db_path).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_url = f"sqlite+aiosqlite:///{db_path}"

    engine = create_async_engine(db_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    # Ensure all tables exist via Alembic (creates alembic_version table too)
    _run_alembic_migrations(db_path)

    # ── Phase 1: Copy ────────────────────────────────────────────────────────
    if not args.in_place:
        source_map = phase1_copy(source, shelf_path)
    else:
        print("\n── Phase 1: Skipped (--in-place) ──")
        # Identity map: dest filename == source filename (no prefix stripping)
        source_map = {p.name: p for p in find_books(source)}

    async with session_factory() as session:
        shelf = await get_or_create_shelf(session, args.shelf_name, str(shelf_path))

        # ── Phase 2: Scan ─────────────────────────────────────────────────────
        await phase2_scan(session, shelf, covers_dir, stats_db_path=stats_db_path)

        # ── Phase 3: Enrich ───────────────────────────────────────────────────
        await phase3_enrich(session, shelf, source_map, args.dry_run)

    await engine.dispose()
    print("\nDone.")


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
