"""Cross-source reading session deduplication."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reading import ReadingSession

log = logging.getLogger(__name__)


async def deduplicate_sessions(
    session: AsyncSession,
    book_id: str,
    tolerance_seconds: int = 300,
) -> int:
    """
    Find and resolve duplicate reading sessions for a book.
    When an sdr session overlaps with a stats_db session (within tolerance),
    the sdr session is dismissed (stats_db preferred for finer granularity).
    Returns count of sessions deduplicated (dismissed).
    """
    # Load all non-dismissed sessions for the book
    result = await session.execute(
        select(ReadingSession).where(
            ReadingSession.book_id == book_id,
            ReadingSession.dismissed == False,  # noqa: E712
        )
    )
    sessions = result.scalars().all()

    # Separate by source
    stats_db_sessions = [s for s in sessions if s.source == "stats_db"]
    sdr_sessions = [s for s in sessions if s.source == "sdr"]

    deduped = 0
    tolerance = timedelta(seconds=tolerance_seconds)

    for sdr_sess in sdr_sessions:
        if sdr_sess.start_time is None:
            continue

        for stats_sess in stats_db_sessions:
            if stats_sess.start_time is None:
                continue

            time_diff = abs(sdr_sess.start_time - stats_sess.start_time)
            if time_diff <= tolerance:
                log.debug(
                    "Deduplicating sdr session %s (start=%s) against"
                    " stats_db session %s (start=%s) for book %s — dismissing sdr",
                    sdr_sess.source_key,
                    sdr_sess.start_time,
                    stats_sess.source_key,
                    stats_sess.start_time,
                    book_id,
                )
                sdr_sess.dismissed = True
                deduped += 1
                break  # Only dismiss once per sdr session

    if deduped > 0:
        await session.commit()

    return deduped
