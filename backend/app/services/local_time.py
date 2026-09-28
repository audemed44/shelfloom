"""Reading times are stored as naive UTC; stats group them in local time.

"Local" is the server's time zone (the ``TZ`` environment variable in
Docker), which for a personal library is the reader's own. Grouping in UTC
would put late-night reading on the wrong day and skew time-of-day charts by
the UTC offset.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement


def local_sql(column) -> ColumnElement:
    """SQL expression for a stored UTC datetime column in local time (SQLite)."""
    return func.datetime(column, "localtime")


def to_local(dt: datetime | None) -> datetime | None:
    """Stored naive UTC → naive local time."""
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    return dt.replace(tzinfo=UTC).astimezone().replace(tzinfo=None)


def to_utc(dt: datetime) -> datetime:
    """Naive local time → naive UTC, for comparing against stored values."""
    return dt.astimezone(UTC).replace(tzinfo=None)


def local_day_bounds(first: date, last: date) -> tuple[datetime, datetime]:
    """UTC bounds covering local days ``first`` through ``last`` inclusive."""
    return (
        to_utc(datetime.combine(first, time.min)),
        to_utc(datetime.combine(last, time.max)),
    )
