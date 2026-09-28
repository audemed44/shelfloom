"""Reading summary in the Foyer widget format.

Foyer (https://github.com/audemed44/foyer) is a homelab dashboard that
renders any app serving this shape. Version 1:

    {
      "version": 1,
      "stats":    [{"label", "value", "unit"?, "caption"?, "tone"?}],
      "progress": [{"label", "value", "max", "caption"?}],
      "items_title": str?, "items_layout": "covers" | "list",
      "items":    [{"title", "subtitle"?, "image"?, "url"?, "progress"?, "caption"?}]
    }

``image`` paths are relative to this API's origin (Foyer fetches them
server-side); ``url`` paths are relative to the app's public address.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reading import ReadingProgress
from app.services.book_service import list_books
from app.services.stats_service import get_overview, get_streaks
from app.services.year_review import goal_progress

MAX_ITEMS = 8

_GOAL_CAPTIONS = {
    "done": "Goal reached",
    "on_track": "On track",
    "missed": "Goal missed",
}


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _goal_caption(goal: dict) -> str | None:
    status = goal.get("status")
    if status in ("ahead", "behind"):
        gap = round(abs(goal["completed"] - goal["expected_by_now"]))
        where = "ahead of" if status == "ahead" else "behind"
        return f"{_plural(gap, 'book')} {where} pace"
    return _GOAL_CAPTIONS.get(status)


def _hours(seconds: float) -> str:
    hours = seconds / 3600
    return f"{hours:.1f}" if hours < 10 else f"{hours:.0f}"


async def build_widget(session: AsyncSession, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    year = now.year

    goal = await goal_progress(session, year)
    streaks = await get_streaks(session)
    library = await get_overview(session)
    week_start = (now - timedelta(days=7)).astimezone(UTC).replace(tzinfo=None)
    week = await get_overview(session, from_dt=week_start)

    stats: list[dict] = []
    year_stat = {"label": f"Read in {year}", "value": str(goal["completed"])}
    if goal.get("target"):
        year_stat["unit"] = f"/{goal['target']}"
        year_stat["tone"] = "good" if goal.get("status") in ("done", "ahead") else None
    stats.append(year_stat)
    stats.append(
        {
            "label": "Streak",
            "value": str(streaks["current"]),
            "unit": "day" if streaks["current"] == 1 else "days",
            "caption": f"best {streaks['longest']}",
        }
    )
    stats.append(
        {
            "label": "This week",
            "value": _hours(week["total_reading_time_seconds"]),
            "unit": "h",
            "caption": _plural(week["total_pages_read"], "page"),
        }
    )
    stats.append(
        {
            "label": "Library",
            "value": str(library["books_read"]),
            "unit": f"/{library['books_owned']}",
            "caption": "books read",
        }
    )

    progress = []
    if goal.get("target"):
        progress.append(
            {
                "label": f"{year} goal",
                "value": goal["completed"],
                "max": goal["target"],
                "caption": _goal_caption(goal),
            }
        )

    books, _, _ = await list_books(session, status="reading", sort="last_read", per_page=MAX_ITEMS)
    progress_map: dict[str, float] = {}
    if books:
        rows = await session.execute(
            select(ReadingProgress.book_id, func.max(ReadingProgress.progress))
            .where(ReadingProgress.book_id.in_([b.id for b in books]))
            .group_by(ReadingProgress.book_id)
        )
        progress_map = {book_id: value for book_id, value in rows.all()}

    items = []
    for book in books:
        pct = progress_map.get(book.id)
        item: dict = {"title": book.title, "url": f"/books/{book.id}"}
        if book.author:
            item["subtitle"] = book.author
        if book.cover_path:
            item["image"] = f"/api/books/{book.id}/cover"
        if pct is not None:
            item["progress"] = round(pct, 1)
            item["caption"] = f"{pct:.0f}%"
        items.append(item)

    return {
        "version": 1,
        "stats": [{k: v for k, v in s.items() if v is not None} for s in stats],
        "progress": [{k: v for k, v in p.items() if v is not None} for p in progress],
        "items_title": "Currently reading",
        "items_layout": "covers",
        "items": items,
    }
