"""Reading statistics service."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.reading import ReadingProgress, ReadingSession
from app.models.tag import BookTag, Tag
from app.services.local_time import local_day_bounds, local_sql, to_local

Granularity = Literal["day", "week", "month"]


def _bucket_sql(granularity: str):
    """Local-time bucket key: the day, the Monday starting the week, or the month."""
    local = local_sql(ReadingSession.start_time)
    if granularity == "day":
        return func.date(local)
    if granularity == "week":
        # 'weekday 0' moves forward to Sunday (or stays), -6 days is that week's Monday.
        return func.date(local, "weekday 0", "-6 days")
    return func.strftime("%Y-%m", local)


def _bucket_keys(granularity: str, first: date, last: date) -> list[str]:
    """Every bucket key from ``first`` to ``last`` inclusive, so gaps show as zero."""
    keys: list[str] = []
    if granularity == "day":
        d = first
        while d <= last:
            keys.append(d.isoformat())
            d += timedelta(days=1)
    elif granularity == "week":
        d = first - timedelta(days=first.weekday())
        while d <= last:
            keys.append(d.isoformat())
            d += timedelta(days=7)
    else:
        y, m = first.year, first.month
        while (y, m) <= (last.year, last.month):
            keys.append(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return keys


def _session_filters(from_dt: datetime | None, to_dt: datetime | None) -> list:
    where = [
        ReadingSession.dismissed == False,  # noqa: E712
        ReadingSession.start_time.is_not(None),
    ]
    if from_dt:
        where.append(ReadingSession.start_time >= from_dt)
    if to_dt:
        where.append(ReadingSession.start_time <= to_dt)
    return where


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_reading_dates(session: AsyncSession) -> list[date]:
    """Sorted unique dates that had at least one non-dismissed session with duration > 0."""
    result = await session.execute(
        select(func.date(local_sql(ReadingSession.start_time)).label("day"))
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

    today = datetime.now().date()

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
    """Totals for the range: books finished, reading time, pages, reading days.

    ``books_owned`` is the whole library. ``pages_per_hour`` only counts
    sessions that recorded both pages and time, so sessions without a page
    count don't drag the speed down. ``first_session_date`` (local) lets the
    client average over the time actually covered when no range is given.
    """
    books_owned: int = (await session.execute(select(func.count()).select_from(Book))).scalar_one()

    # books_read uses exactly the same rule as the completed-books list so the
    # dashboard never shows two different "completed" numbers.
    books_read = len(await get_books_completed(session, from_dt, to_dt))

    where = _session_filters(from_dt, to_dt)
    agg_row = (
        await session.execute(
            select(
                func.coalesce(func.sum(ReadingSession.duration), 0),
                func.coalesce(func.sum(ReadingSession.pages_read), 0),
                func.count(ReadingSession.id),
                func.count(
                    func.distinct(
                        case(
                            (
                                ReadingSession.duration > 0,
                                func.date(local_sql(ReadingSession.start_time)),
                            )
                        )
                    )
                ),
                func.min(ReadingSession.start_time),
            ).where(*where)
        )
    ).one()
    total_seconds: int = agg_row[0] or 0
    total_pages: int = agg_row[1] or 0

    speed_row = (
        await session.execute(
            select(
                func.coalesce(func.sum(ReadingSession.pages_read), 0),
                func.coalesce(func.sum(ReadingSession.duration), 0),
            ).where(*where, ReadingSession.pages_read > 0, ReadingSession.duration > 0)
        )
    ).one()
    pages_per_hour = (
        round(speed_row[0] / speed_row[1] * 3600, 1) if speed_row[1] and speed_row[0] else None
    )
    first = to_local(agg_row[4])

    dates = await _get_reading_dates(session)
    streak = _streak_from_dates(dates)

    return {
        "books_owned": books_owned,
        "books_read": books_read,
        "total_reading_time_seconds": total_seconds,
        "total_pages_read": total_pages,
        "sessions": agg_row[2] or 0,
        "reading_days": agg_row[3] or 0,
        "pages_per_hour": pages_per_hour,
        "first_session_date": first.date().isoformat() if first else None,
        "current_streak_days": streak["current"],
    }


async def get_time_series(
    session: AsyncSession,
    metric: Literal["duration", "pages"],
    granularity: Granularity,
    from_dt: datetime | None,
    to_dt: datetime | None,
) -> list[dict]:
    """Reading time or pages per day, week (keyed by its Monday) or month.

    Buckets are in local time, and every bucket from the start of the range
    (or the first session) to its end (or today) is included, zeros too, so
    charts show gaps as gaps.
    """
    col = ReadingSession.duration if metric == "duration" else ReadingSession.pages_read
    bucket = _bucket_sql(granularity).label("bucket")
    q = (
        select(bucket, func.coalesce(func.sum(col), 0).label("value"))
        .where(*_session_filters(from_dt, to_dt))
        .group_by("bucket")
        .order_by("bucket")
    )
    rows = (await session.execute(q)).all()
    values = {r.bucket: r.value or 0 for r in rows if r.bucket}
    if not values and from_dt is None:
        return []

    first = to_local(from_dt).date() if from_dt else _bucket_start(min(values), granularity)
    last = to_local(to_dt).date() if to_dt else datetime.now().date()
    if values:
        last = max(last, _bucket_start(max(values), granularity))
    return [{"date": k, "value": values.get(k, 0)} for k in _bucket_keys(granularity, first, last)]


def _bucket_start(key: str, granularity: str) -> date:
    return date.fromisoformat(key if granularity != "month" else f"{key}-01")


async def get_books_completed(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[dict]:
    """Books with progress >= 99.0 (excluding DNF), most recently completed first.

    When ``from_dt``/``to_dt`` are given, only books completed within the window
    are returned. The completion time is the last reading session, falling back
    to the progress update time for books marked read without sessions.
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
        .where(Book.reading_state.is_(None) | (Book.reading_state != "dnf"))
        .group_by(Book.id, ReadingProgress.book_id)
    )
    # A book counts as completed at its last reading session, or — for books
    # marked read without any sessions — when its progress was last updated.
    completed_at = func.coalesce(
        func.max(ReadingSession.start_time), func.max(ReadingProgress.updated_at)
    )
    if from_dt:
        q = q.having(completed_at >= from_dt)
    if to_dt:
        q = q.having(completed_at <= to_dt)
    q = q.order_by(completed_at.desc())

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
                    # Local time, like every other date the stats return.
                    "completed_at": to_local(last_session or prog.updated_at),
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
            func.date(local_sql(ReadingSession.start_time)).label("day"),
            func.coalesce(func.sum(ReadingSession.duration), 0).label("seconds"),
        )
        .where(
            *_session_filters(*local_day_bounds(date(year, 1, 1), date(year, 12, 31))),
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


async def get_distribution(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> dict:
    """Reading time by local hour of day and day of week.

    SQLite %H → "00"–"23", %w → "0"(Sun)–"6"(Sat).
    """
    local = local_sql(ReadingSession.start_time)
    where = _session_filters(from_dt, to_dt)

    async def by(fmt: str) -> dict[int, int]:
        rows = (
            await session.execute(
                select(
                    func.strftime(fmt, local).label("k"),
                    func.coalesce(func.sum(ReadingSession.duration), 0).label("seconds"),
                )
                .where(*where)
                .group_by("k")
            )
        ).all()
        return {int(r.k): r.seconds or 0 for r in rows if r.k is not None}

    hour_map = await by("%H")
    weekday_map = await by("%w")
    return {
        "by_hour": [{"hour": h, "seconds": hour_map.get(h, 0)} for h in range(24)],
        # 0=Sun … 6=Sat (SQLite convention)
        "by_weekday": [{"weekday": w, "seconds": weekday_map.get(w, 0)} for w in range(7)],
    }


async def get_by_author(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[dict]:
    """Reading time and session count grouped by author, sorted descending."""
    rows = (
        await session.execute(
            select(
                Book.author,
                func.coalesce(func.sum(ReadingSession.duration), 0).label("total_seconds"),
                func.count(ReadingSession.id).label("session_count"),
            )
            .join(ReadingSession, ReadingSession.book_id == Book.id)
            .where(*_session_filters(from_dt, to_dt), Book.author.is_not(None))
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


async def get_by_tag(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[dict]:
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
            .where(*_session_filters(from_dt, to_dt))
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
    last_day = (date(year + (month == 12), month % 12 + 1, 1)) - timedelta(days=1)
    start_dt, end_dt = local_day_bounds(date(year, month, 1), last_day)

    result = await session.execute(
        select(
            func.date(local_sql(ReadingSession.start_time)).label("day"),
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
