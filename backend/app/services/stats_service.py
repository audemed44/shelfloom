"""Reading statistics service."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import ReadingProgress, ReadingSession
from app.models.tag import BookTag, Tag

Granularity = Literal["day", "week", "month"]

_STRFTIME_FMTS: dict[str, str] = {
    "day": "%Y-%m-%d",
    "week": "%Y-%W",
    "month": "%Y-%m",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_reading_dates(session: AsyncSession) -> list[date]:
    """Sorted unique dates that had at least one non-dismissed session with duration > 0."""
    result = await session.execute(
        select(func.strftime("%Y-%m-%d", ReadingSession.start_time).label("day"))
        .where(
            ReadingSession.dismissed == False,  # noqa: E712
            ReadingSession.start_time.is_not(None),
            ReadingSession.duration > 0,
        )
        .group_by("day")
        .order_by("day")
    )
    raw = result.scalars().all()
    return [date.fromisoformat(r) for r in raw if r]


def _streak_from_dates(dates: list[date]) -> dict:
    """Compute current / longest streak and history from a sorted list of reading dates."""
    if not dates:
        return {"current": 0, "longest": 0, "last_read_date": None, "history": []}

    today = datetime.now(UTC).date()

    # Build consecutive runs
    runs: list[dict] = []
    run_start = dates[0]
    run_len = 1
    for i in range(1, len(dates)):
        if (dates[i] - dates[i - 1]).days == 1:
            run_len += 1
        else:
            runs.append(
                {
                    "start": run_start.isoformat(),
                    "end": dates[i - 1].isoformat(),
                    "days": run_len,
                }
            )
            run_start = dates[i]
            run_len = 1
    runs.append({"start": run_start.isoformat(), "end": dates[-1].isoformat(), "days": run_len})

    longest = max(r["days"] for r in runs)
    last = dates[-1]
    current = runs[-1]["days"] if (today - last).days <= 1 else 0

    return {
        "current": current,
        "longest": longest,
        "last_read_date": last.isoformat(),
        "history": runs,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_overview(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> dict:
    """High-level totals: books owned, read, time, pages, current streak.

    When ``from_dt``/``to_dt`` are supplied the time-based metrics (reading
    time, pages, books read) are scoped to sessions within that window.
    """
    books_owned: int = (await session.execute(select(func.count()).select_from(Book))).scalar_one()

    # books_read: completed books (progress >= 99%) that have at least one
    # session in the requested time window (or all time when no window given).
    books_read_q = (
        select(func.count(func.distinct(ReadingProgress.book_id)))
        .join(ReadingSession, ReadingSession.book_id == ReadingProgress.book_id)
        .where(
            ReadingProgress.progress >= 99.0,
            ReadingSession.dismissed == False,  # noqa: E712
        )
    )
    if from_dt:
        books_read_q = books_read_q.where(ReadingSession.start_time >= from_dt)
    if to_dt:
        books_read_q = books_read_q.where(ReadingSession.start_time <= to_dt)
    books_read: int = (await session.execute(books_read_q)).scalar_one()

    agg_q = select(
        func.coalesce(func.sum(ReadingSession.duration), 0),
        func.coalesce(func.sum(ReadingSession.pages_read), 0),
    ).where(ReadingSession.dismissed == False)  # noqa: E712
    if from_dt:
        agg_q = agg_q.where(ReadingSession.start_time >= from_dt)
    if to_dt:
        agg_q = agg_q.where(ReadingSession.start_time <= to_dt)
    agg_row = (await session.execute(agg_q)).one()
    total_seconds: int = agg_row[0] or 0
    total_pages: int = agg_row[1] or 0

    dates = await _get_reading_dates(session)
    streak = _streak_from_dates(dates)

    return {
        "books_owned": books_owned,
        "books_read": books_read,
        "total_reading_time_seconds": total_seconds,
        "total_pages_read": total_pages,
        "current_streak_days": streak["current"],
    }


async def get_time_series(
    session: AsyncSession,
    metric: Literal["duration", "pages"],
    granularity: Granularity,
    from_dt: datetime | None,
    to_dt: datetime | None,
) -> list[dict]:
    """Aggregated reading-time or pages time series grouped by granularity."""
    fmt = _STRFTIME_FMTS[granularity]
    col = ReadingSession.duration if metric == "duration" else ReadingSession.pages_read

    q = select(
        func.strftime(fmt, ReadingSession.start_time).label("bucket"),
        func.coalesce(func.sum(col), 0).label("value"),
    ).where(
        ReadingSession.dismissed == False,  # noqa: E712
        ReadingSession.start_time.is_not(None),
    )
    if from_dt:
        q = q.where(ReadingSession.start_time >= from_dt)
    if to_dt:
        q = q.where(ReadingSession.start_time <= to_dt)

    q = q.group_by("bucket").order_by("bucket")
    rows = (await session.execute(q)).all()
    return [{"date": r.bucket, "value": r.value or 0} for r in rows]


async def get_books_completed(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[dict]:
    """Books with progress >= 99.0, ordered by most-recent reading session.

    When ``from_dt``/``to_dt`` are given, only books whose last session falls
    within the window are returned (HAVING on max start_time).
    """
    q = (
        select(
            Book,
            ReadingProgress,
            func.max(ReadingSession.start_time).label("last_session"),
        )
        .join(ReadingProgress, ReadingProgress.book_id == Book.id)
        .outerjoin(
            ReadingSession,
            and_(
                ReadingSession.book_id == Book.id,
                ReadingSession.dismissed == False,  # noqa: E712
            ),
        )
        .where(ReadingProgress.progress >= 99.0)
        .group_by(Book.id, ReadingProgress.book_id)
    )
    if from_dt:
        q = q.having(func.max(ReadingSession.start_time) >= from_dt)
    if to_dt:
        q = q.having(func.max(ReadingSession.start_time) <= to_dt)
    q = q.order_by(func.max(ReadingSession.start_time).desc())

    rows = (await session.execute(q)).all()
    seen: set[str] = set()
    out: list[dict] = []
    for book, prog, last_session in rows:
        if book.id not in seen:
            seen.add(book.id)
            out.append(
                {
                    "book_id": book.id,
                    "title": book.title,
                    "author": book.author,
                    "completed_at": last_session or prog.updated_at,
                    "cover_path": book.cover_path,
                }
            )
    return out


async def get_streaks(session: AsyncSession) -> dict:
    """Current and longest reading streaks with full history."""
    dates = await _get_reading_dates(session)
    return _streak_from_dates(dates)


async def get_heatmap(session: AsyncSession, year: int) -> list[dict]:
    """Daily reading seconds for every day of the given year (zeros filled in)."""
    result = await session.execute(
        select(
            func.strftime("%Y-%m-%d", ReadingSession.start_time).label("day"),
            func.coalesce(func.sum(ReadingSession.duration), 0).label("seconds"),
        )
        .where(
            ReadingSession.dismissed == False,  # noqa: E712
            ReadingSession.start_time.is_not(None),
            func.strftime("%Y", ReadingSession.start_time) == str(year),
        )
        .group_by("day")
        .order_by("day")
    )
    day_map = {r.day: r.seconds or 0 for r in result.all()}

    start = date(year, 1, 1)
    end = date(year, 12, 31)
    out: list[dict] = []
    d = start
    while d <= end:
        key = d.isoformat()
        out.append({"date": key, "seconds": day_map.get(key, 0)})
        d += timedelta(days=1)
    return out


async def get_distribution(session: AsyncSession) -> dict:
    """Reading time broken down by hour-of-day and day-of-week.

    SQLite %H → "00"–"23", %w → "0"(Sun)–"6"(Sat).
    """
    base_where = [
        ReadingSession.dismissed == False,  # noqa: E712
        ReadingSession.start_time.is_not(None),
    ]

    hour_rows = (
        await session.execute(
            select(
                func.strftime("%H", ReadingSession.start_time).label("hour"),
                func.coalesce(func.sum(ReadingSession.duration), 0).label("seconds"),
            )
            .where(*base_where)
            .group_by("hour")
            .order_by("hour")
        )
    ).all()
    hour_map = {int(r.hour): r.seconds or 0 for r in hour_rows}
    by_hour = [{"hour": h, "seconds": hour_map.get(h, 0)} for h in range(24)]

    weekday_rows = (
        await session.execute(
            select(
                func.strftime("%w", ReadingSession.start_time).label("weekday"),
                func.coalesce(func.sum(ReadingSession.duration), 0).label("seconds"),
            )
            .where(*base_where)
            .group_by("weekday")
            .order_by("weekday")
        )
    ).all()
    weekday_map = {int(r.weekday): r.seconds or 0 for r in weekday_rows}
    # 0=Sun … 6=Sat (SQLite convention)
    by_weekday = [{"weekday": w, "seconds": weekday_map.get(w, 0)} for w in range(7)]

    return {"by_hour": by_hour, "by_weekday": by_weekday}


async def get_by_author(session: AsyncSession) -> list[dict]:
    """Reading time and session count grouped by author, sorted descending."""
    rows = (
        await session.execute(
            select(
                Book.author,
                func.coalesce(func.sum(ReadingSession.duration), 0).label("total_seconds"),
                func.count(ReadingSession.id).label("session_count"),
            )
            .join(ReadingSession, ReadingSession.book_id == Book.id)
            .where(
                ReadingSession.dismissed == False,  # noqa: E712
                Book.author.is_not(None),
            )
            .group_by(Book.author)
            .order_by(func.sum(ReadingSession.duration).desc())
        )
    ).all()
    return [
        {
            "author": r.author,
            "total_seconds": r.total_seconds or 0,
            "session_count": r.session_count,
        }
        for r in rows
    ]


async def get_by_tag(session: AsyncSession) -> list[dict]:
    """Reading time and session count grouped by tag, sorted descending."""
    rows = (
        await session.execute(
            select(
                Tag.name,
                func.coalesce(func.sum(ReadingSession.duration), 0).label("total_seconds"),
                func.count(ReadingSession.id).label("session_count"),
            )
            .join(BookTag, BookTag.tag_id == Tag.id)
            .join(ReadingSession, ReadingSession.book_id == BookTag.book_id)
            .where(ReadingSession.dismissed == False)  # noqa: E712
            .group_by(Tag.name)
            .order_by(func.sum(ReadingSession.duration).desc())
        )
    ).all()
    return [
        {
            "tag": r.name,
            "total_seconds": r.total_seconds or 0,
            "session_count": r.session_count,
        }
        for r in rows
    ]


async def get_recent_sessions(session: AsyncSession, limit: int = 10) -> list[dict]:
    """Most recent non-dismissed reading sessions with book info."""
    result = await session.execute(
        select(ReadingSession, Book)
        .join(Book, ReadingSession.book_id == Book.id)
        .where(
            ReadingSession.dismissed == False,  # noqa: E712
            ReadingSession.start_time.is_not(None),
            ReadingSession.duration > 0,
        )
        .order_by(ReadingSession.start_time.desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "book_id": str(book.id),
            "title": book.title,
            "author": book.author,
            "duration": rs.duration,
            "pages_read": rs.pages_read,
            "start_time": rs.start_time.isoformat() if rs.start_time else None,
        }
        for rs, book in rows
    ]


async def get_calendar_month(session: AsyncSession, year: int, month: int) -> list[dict]:
    """Sessions grouped by date for a calendar month, with book info.

    Returns one entry per day in the month; days with no sessions have ``books: []``.
    """
    if month < 12:
        end_dt = datetime(year, month + 1, 1, tzinfo=UTC) - timedelta(seconds=1)
    else:
        end_dt = datetime(year + 1, 1, 1, tzinfo=UTC) - timedelta(seconds=1)
    start_dt = datetime(year, month, 1, tzinfo=UTC)

    result = await session.execute(
        select(
            func.strftime("%Y-%m-%d", ReadingSession.start_time).label("day"),
            Book.id.label("book_id"),
            Book.title,
            func.coalesce(func.sum(ReadingSession.duration), 0).label("total_duration"),
        )
        .join(Book, ReadingSession.book_id == Book.id)
        .where(
            ReadingSession.dismissed == False,  # noqa: E712
            ReadingSession.start_time.is_not(None),
            ReadingSession.start_time >= start_dt,
            ReadingSession.start_time <= end_dt,
            ReadingSession.duration > 0,
        )
        .group_by("day", Book.id)
        .order_by("day", func.sum(ReadingSession.duration).desc())
    )

    day_map: dict[str, list[dict]] = {}
    for row in result.all():
        if row.day not in day_map:
            day_map[row.day] = []
        day_map[row.day].append(
            {
                "book_id": str(row.book_id),
                "title": row.title,
                "duration": row.total_duration or 0,
            }
        )

    out: list[dict] = []
    d = date(year, month, 1)
    while d.month == month:
        key = d.isoformat()
        out.append({"date": key, "books": day_map.get(key, [])})
        d += timedelta(days=1)
    return out


async def get_book_stats(session: AsyncSession, book_id: str) -> dict | None:
    """Per-book analytics. Returns None if book doesn't exist."""
    book = (await session.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
    if book is None:
        return None

    sessions = (
        (
            await session.execute(
                select(ReadingSession)
                .where(
                    ReadingSession.book_id == book_id,
                    ReadingSession.dismissed == False,  # noqa: E712
                )
                .order_by(ReadingSession.start_time)
            )
        )
        .scalars()
        .all()
    )

    total_seconds = sum(s.duration or 0 for s in sessions)
    total_pages = sum(s.pages_read or 0 for s in sessions)
    session_count = len(sessions)

    avg_pages_per_hour: float | None = None
    if total_seconds > 0 and total_pages > 0:
        avg_pages_per_hour = round((total_pages / total_seconds) * 3600, 2)

    valid_times = [s.start_time for s in sessions if s.start_time]
    first_session = min(valid_times) if valid_times else None
    last_session = max(valid_times) if valid_times else None

    prog = (
        await session.execute(
            select(ReadingProgress)
            .where(ReadingProgress.book_id == book_id)
            .order_by(ReadingProgress.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return {
        "book_id": book.id,
        "title": book.title,
        "author": book.author,
        "total_seconds": total_seconds,
        "total_pages": total_pages,
        "session_count": session_count,
        "avg_pages_per_hour": avg_pages_per_hour,
        "first_session": first_session,
        "last_session": last_session,
        "progress": prog.progress if prog else None,
    }
