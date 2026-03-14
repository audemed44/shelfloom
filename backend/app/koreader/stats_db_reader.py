"""Read KOReader statistics.sqlite3 database."""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger(__name__)

SESSION_GAP_SECONDS = 600  # 10 minutes


@dataclass
class StatsBook:
    """A book entry from KOReader stats DB."""

    id: int
    title: str
    authors: str | None
    md5: str | None
    series: str | None
    language: str | None
    total_read_time: int | None
    total_read_pages: int | None
    last_open: int | None
    ko_total_pages: int | None = None  # KOReader's page count (mode across sessions)


@dataclass
class StatsSession:
    """An aggregated reading session."""

    book_id: int
    start_time: datetime
    duration: int  # seconds
    pages_read: int
    source_key: str


def _aggregate_page_stats(
    rows: list[tuple[int, int, int]],  # (page, start_time, period)
    book_md5: str | None,
    book_id: int,
) -> list[StatsSession]:
    """Group page_stat_data rows into sessions based on time gaps."""
    if not rows:
        return []

    # Sort by start_time
    sorted_rows = sorted(rows, key=lambda r: r[1])

    sessions: list[StatsSession] = []
    current_group: list[tuple[int, int, int]] = [sorted_rows[0]]

    for row in sorted_rows[1:]:
        prev_end = current_group[-1][1] + current_group[-1][2]  # prev start + period
        cur_start = row[1]
        if cur_start - prev_end > SESSION_GAP_SECONDS:
            sessions.append(_build_stats_session(current_group, book_md5, book_id))
            current_group = [row]
        else:
            current_group.append(row)

    sessions.append(_build_stats_session(current_group, book_md5, book_id))
    return sessions


def _build_stats_session(
    group: list[tuple[int, int, int]],
    book_md5: str | None,
    book_id: int,
) -> StatsSession:
    start_ts = group[0][1]
    duration = sum(r[2] for r in group)
    pages_read = len(set(r[0] for r in group))

    start_dt = datetime.fromtimestamp(start_ts, tz=UTC).replace(tzinfo=None)

    if book_md5:
        source_key = f"stats_db:{book_md5}:{start_ts}"
    else:
        source_key = f"stats_db:id{book_id}:{start_ts}"

    return StatsSession(
        book_id=book_id,
        start_time=start_dt,
        duration=duration,
        pages_read=pages_read,
        source_key=source_key,
    )


def read_stats_db(
    db_path: str | Path,
) -> tuple[list[StatsBook], dict[int, list[StatsSession]]]:
    """
    Read KOReader statistics.sqlite3 synchronously.
    Returns (books, sessions_by_book_id).
    Opens read-only.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        raise FileNotFoundError(f"Stats DB not found: {db_path}")

    uri = db_path.as_uri() + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except Exception:
        # Fallback: open normally
        conn = sqlite3.connect(str(db_path))

    books: list[StatsBook] = []
    sessions_by_book: dict[int, list[StatsSession]] = {}

    try:
        conn.row_factory = sqlite3.Row

        # Read books
        cursor = conn.execute(
            "SELECT id, title, authors, md5, series, language, "
            "total_read_time, total_read_pages, last_open FROM book"
        )
        for row in cursor.fetchall():
            book = StatsBook(
                id=row["id"],
                title=row["title"] or "",
                authors=row["authors"] or None,
                md5=row["md5"] or None,
                series=row["series"] or None,
                language=row["language"] or None,
                total_read_time=row["total_read_time"],
                total_read_pages=row["total_read_pages"],
                last_open=row["last_open"],
            )
            books.append(book)

        # Read page_stat_data grouped by book
        book_ids = [b.id for b in books]
        if book_ids:
            placeholders = ",".join("?" * len(book_ids))
            cursor = conn.execute(
                f"SELECT id_book, page, start_time, duration, total_pages "
                f"FROM page_stat_data WHERE id_book IN ({placeholders}) "
                f"ORDER BY id_book, start_time",
                book_ids,
            )
            # Group rows by book
            raw_by_book: dict[int, list[tuple[int, int, int]]] = {}
            total_pages_by_book: dict[int, list[int]] = {}
            for row in cursor.fetchall():
                bid = row["id_book"]
                if bid not in raw_by_book:
                    raw_by_book[bid] = []
                    total_pages_by_book[bid] = []
                raw_by_book[bid].append((row["page"], row["start_time"], row["duration"]))
                if row["total_pages"]:
                    total_pages_by_book[bid].append(row["total_pages"])

            # Compute mode of total_pages per book (most common value = most typical layout)
            ko_pages_map: dict[int, int] = {}
            for bid, tp_list in total_pages_by_book.items():
                if tp_list:
                    ko_pages_map[bid] = max(set(tp_list), key=tp_list.count)

            # Aggregate sessions per book
            book_md5_map = {b.id: b.md5 for b in books}
            for bid, rows in raw_by_book.items():
                sessions_by_book[bid] = _aggregate_page_stats(rows, book_md5_map.get(bid), bid)

            # Attach ko_total_pages to each StatsBook
            for book in books:
                book.ko_total_pages = ko_pages_map.get(book.id)

    finally:
        conn.close()

    return books, sessions_by_book
