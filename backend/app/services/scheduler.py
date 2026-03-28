"""Background scan scheduler."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from app.services.import_service import ImportProgress

log = logging.getLogger(__name__)


@dataclass
class ScanStatus:
    is_running: bool = False
    last_scan_at: datetime | None = None
    progress: ImportProgress | None = None
    error: str | None = None


class Scheduler:
    """Manages periodic and manual library scans and serial update checks."""

    def __init__(self) -> None:
        self.status = ScanStatus()
        self.mtime_cache: dict[str, float] = {}
        self._loop_task: asyncio.Task | None = None
        self._serial_check_task: asyncio.Task | None = None

    async def start(self, session_factory, settings, covers_dir: str) -> None:
        """Start background loops for library scanning and serial update checking."""
        self._loop_task = asyncio.create_task(self._loop(session_factory, settings, covers_dir))
        self._serial_check_task = asyncio.create_task(
            self._serial_check_loop(session_factory, settings)
        )

    async def stop(self) -> None:
        """Cancel all background loops."""
        for task in (self._loop_task, self._serial_check_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._loop_task = None
        self._serial_check_task = None

    async def trigger(self, session_factory, settings, covers_dir: str) -> asyncio.Task | None:
        """Manually trigger a scan. Returns the task, or None if already running."""
        if self.status.is_running:
            return None
        task = asyncio.create_task(self._run_scan(session_factory, settings, covers_dir))
        return task

    async def trigger_serial_check(self, session_factory) -> asyncio.Task | None:
        """Manually trigger a serial update check. Returns the task."""
        from app.services.serial_service import check_all_serials_for_updates

        task = asyncio.create_task(check_all_serials_for_updates(session_factory))
        return task

    async def _loop(self, session_factory, settings, covers_dir: str) -> None:
        """Periodic loop: scan then sleep."""
        while True:
            await self._run_scan(session_factory, settings, covers_dir)
            await asyncio.sleep(settings.scan_interval)

    async def _serial_check_loop(self, session_factory, settings) -> None:
        """Periodic loop: check serials for new chapters."""
        from app.services.serial_service import check_all_serials_for_updates

        while True:
            try:
                result = await check_all_serials_for_updates(session_factory)
                log.info(
                    "Serial check complete: %d checked, %d new chapters",
                    result["checked"],
                    result["new_chapters"],
                )
            except Exception as e:
                log.error("Serial check failed: %s", e, exc_info=True)
            await asyncio.sleep(settings.serial_check_interval)

    async def _run_scan(self, session_factory, settings, covers_dir: str) -> None:
        if self.status.is_running:
            return
        self.status.is_running = True
        self.status.error = None
        try:
            from sqlalchemy import select

            from app.models.shelf import Shelf
            from app.services.import_service import import_shelf

            async with session_factory() as session:
                result = await session.execute(select(Shelf))
                shelves = list(result.scalars().all())

                combined = ImportProgress()
                for shelf in shelves:
                    from pathlib import Path as _Path

                    stats_db = shelf.koreader_stats_db_path
                    stats_db_path = (
                        _Path(stats_db) if stats_db and _Path(stats_db).is_file() else None
                    )
                    p = await import_shelf(
                        session,
                        shelf,
                        covers_dir,
                        mtime_cache=self.mtime_cache,
                        stats_db_path=stats_db_path,
                    )
                    combined.total += p.total
                    combined.processed += p.processed
                    combined.created += p.created
                    combined.updated += p.updated
                    combined.skipped += p.skipped
                    combined.errors.extend(p.errors)

            self.status.progress = combined
            self.status.last_scan_at = datetime.now(UTC)
        except Exception as e:
            self.status.error = str(e)
            log.error("Scan failed: %s", e, exc_info=True)
        finally:
            self.status.is_running = False
