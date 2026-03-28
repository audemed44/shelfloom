"""Serial management service — add, update, delete web serials and their volumes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.series import BookSeries, Series
from app.schemas.serial import (
    AutoSplitConfig,
    ChapterFetchJobResponse,
    ChapterFetchLogEntry,
    ChapterFetchStatusResponse,
    ChapterResponse,
    PendingChapterBatchStatusResponse,
    PendingChapterFetchResponse,
    SerialCreate,
    SerialUpdate,
    SingleVolumeCreate,
    VolumeConfigCreate,
    VolumePreviewResponse,
    VolumeRange,
    VolumeUpdate,
)
from app.scrapers.base import ChapterInfo, normalize_url
from app.scrapers.registry import get_adapter, get_adapter_by_name

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SerialNotFound(Exception):
    pass


class SerialAlreadyExists(Exception):
    pass


class ScrapingError(Exception):
    pass


class VolumeGenerationError(Exception):
    pass


class ChapterFetchAlreadyRunning(Exception):
    pass


class PendingChapterBatchAlreadyRunning(Exception):
    pass


class ChapterFetchBatchBusy(Exception):
    pass


_FETCH_JOB_LOG_LIMIT = 100
_FETCH_JOB_RETENTION_SECONDS = 300
_WORDS_PER_PAGE = 280


@dataclass
class _ChapterFetchJob:
    serial_id: int
    start: int
    end: int
    total: int
    chapter_numbers: tuple[int, ...] | None = None
    state: str = "running"
    processed: int = 0
    fetched: int = 0
    skipped: int = 0
    failed: int = 0
    current_chapter_number: int | None = None
    current_chapter_title: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    logs: list[ChapterFetchLogEntry] = field(default_factory=list)
    error: str | None = None
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def to_job_response(self) -> ChapterFetchJobResponse:
        return ChapterFetchJobResponse(
            serial_id=self.serial_id,
            state=self.state,
            start=self.start,
            end=self.end,
            total=self.total,
            started_at=self.started_at,
        )

    def to_status_response(self) -> ChapterFetchStatusResponse:
        return ChapterFetchStatusResponse(
            serial_id=self.serial_id,
            state=self.state,
            start=self.start,
            end=self.end,
            total=self.total,
            processed=self.processed,
            fetched=self.fetched,
            skipped=self.skipped,
            failed=self.failed,
            current_chapter_number=self.current_chapter_number,
            current_chapter_title=self.current_chapter_title,
            started_at=self.started_at,
            finished_at=self.finished_at,
            logs=list(self.logs),
            error=self.error,
        )


_chapter_fetch_jobs: dict[int, _ChapterFetchJob] = {}
_chapter_fetch_jobs_lock = asyncio.Lock()


class _ChapterFetchProgressReporter:
    def __init__(self, job: _ChapterFetchJob):
        self.job = job

    @staticmethod
    def _chapter_label(chapter: SerialChapter) -> str:
        if chapter.title:
            return f'chapter {chapter.chapter_number} "{chapter.title}"'
        return f"chapter {chapter.chapter_number}"

    async def _append_log(
        self, level: str, message: str, chapter_number: int | None = None
    ) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.logs.append(
                ChapterFetchLogEntry(
                    timestamp=datetime.now(UTC),
                    level=level,
                    message=message,
                    chapter_number=chapter_number,
                )
            )
            if len(self.job.logs) > _FETCH_JOB_LOG_LIMIT:
                del self.job.logs[:-_FETCH_JOB_LOG_LIMIT]

    async def mark_started(self) -> None:
        await self._append_log(
            "info",
            (
                f"Started fetching chapters {self.job.start}-{self.job.end} "
                f"for serial {self.job.serial_id}"
            ),
        )

    async def mark_chapter_started(self, chapter: SerialChapter) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.current_chapter_number = chapter.chapter_number
            self.job.current_chapter_title = chapter.title
        await self._append_log(
            "info",
            f"Fetching {self._chapter_label(chapter)}",
            chapter.chapter_number,
        )

    async def mark_chapter_skipped(self, chapter: SerialChapter) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.processed += 1
            self.job.skipped += 1
            self.job.current_chapter_number = None
            self.job.current_chapter_title = None
        await self._append_log(
            "info",
            f"Skipped {self._chapter_label(chapter)}; content already present",
            chapter.chapter_number,
        )

    async def mark_chapter_fetched(self, chapter: SerialChapter) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.processed += 1
            self.job.fetched += 1
            self.job.current_chapter_number = None
            self.job.current_chapter_title = None
        await self._append_log(
            "info",
            (
                f"Fetched {self._chapter_label(chapter)}"
                + (f" ({chapter.word_count} words)" if chapter.word_count is not None else "")
            ),
            chapter.chapter_number,
        )

    async def mark_chapter_failed(self, chapter: SerialChapter, error: str) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.processed += 1
            self.job.failed += 1
            self.job.current_chapter_number = None
            self.job.current_chapter_title = None
        await self._append_log(
            "warning",
            f"Failed to fetch {self._chapter_label(chapter)}: {error}",
            chapter.chapter_number,
        )

    async def mark_completed(self) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.state = "completed"
            self.job.finished_at = datetime.now(UTC)
            self.job.current_chapter_number = None
            self.job.current_chapter_title = None
        await self._append_log("info", "Finished fetching requested chapter range")

    async def mark_error(self, error: str) -> None:
        async with _chapter_fetch_jobs_lock:
            self.job.state = "error"
            self.job.error = error
            self.job.finished_at = datetime.now(UTC)
            self.job.current_chapter_number = None
            self.job.current_chapter_title = None
        await self._append_log("error", error)


@dataclass
class _PendingChapterBatchJob:
    total_serials: int
    state: str = "running"
    processed_serials: int = 0
    current_serial_id: int | None = None
    started: int = 0
    already_running: int = 0
    noop: int = 0
    failed: int = 0
    new_chapters: int = 0
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    error: str | None = None
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def to_status_response(self) -> PendingChapterBatchStatusResponse:
        return PendingChapterBatchStatusResponse(
            state=self.state,
            total_serials=self.total_serials,
            processed_serials=self.processed_serials,
            current_serial_id=self.current_serial_id,
            started=self.started,
            already_running=self.already_running,
            noop=self.noop,
            failed=self.failed,
            new_chapters=self.new_chapters,
            started_at=self.started_at,
            finished_at=self.finished_at,
            error=self.error,
        )


_pending_chapter_batch_job: _PendingChapterBatchJob | None = None
_pending_chapter_batch_job_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _download_cover(url: str, dest: Path) -> bool:
    """Download a cover image to *dest*. Returns True on success."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        return True
    except Exception as exc:
        log.warning("Failed to download cover from %s: %s", url, exc)
        return False


def _covers_dir() -> Path:
    from app.config import get_settings

    return Path(get_settings().covers_dir)


@dataclass(frozen=True)
class VolumeMetrics:
    total_words: int
    fetched_chapter_count: int
    chapter_count: int
    is_partial: bool
    stubbed_missing_count: int


def _chapter_source_key(source_url: str) -> str:
    return normalize_url(source_url)


async def _mark_generated_volumes_stale(
    session: AsyncSession, serial_id: int, changed_numbers: set[int]
) -> None:
    if not changed_numbers:
        return

    vol_result = await session.execute(
        select(SerialVolume).where(
            SerialVolume.serial_id == serial_id,
            SerialVolume.generated_at.isnot(None),
        )
    )
    for vol in vol_result.scalars().all():
        if any(vol.chapter_start <= n <= vol.chapter_end for n in changed_numbers):
            vol.is_stale = True


async def _sync_remote_chapter_list(
    session: AsyncSession,
    serial: WebSerial,
    remote_chapters: list[ChapterInfo],
) -> tuple[int, set[int]]:
    existing_result = await session.execute(
        select(SerialChapter)
        .where(SerialChapter.serial_id == serial.id)
        .order_by(SerialChapter.chapter_number)
    )
    existing_chapters = list(existing_result.scalars().all())
    existing_by_key = {chapter.source_key: chapter for chapter in existing_chapters}
    next_number = max((chapter.chapter_number for chapter in existing_chapters), default=0) + 1

    now = datetime.now(UTC)
    seen_keys: set[str] = set()
    changed_numbers: set[int] = set()
    new_count = 0

    for remote in remote_chapters:
        source_key = _chapter_source_key(remote.source_url)
        if source_key in seen_keys:
            continue
        seen_keys.add(source_key)

        existing = existing_by_key.get(source_key)
        if existing is None:
            session.add(
                SerialChapter(
                    serial_id=serial.id,
                    chapter_number=next_number,
                    source_key=source_key,
                    title=remote.title,
                    source_url=remote.source_url,
                    publish_date=remote.publish_date,
                    is_stubbed=False,
                )
            )
            changed_numbers.add(next_number)
            next_number += 1
            new_count += 1
            continue

        existing.title = remote.title
        existing.source_url = remote.source_url
        existing.publish_date = remote.publish_date
        if existing.is_stubbed:
            existing.is_stubbed = False
            existing.stubbed_at = None
            changed_numbers.add(existing.chapter_number)

    live_chapter_count = 0
    for chapter in existing_chapters:
        if chapter.source_key in seen_keys:
            live_chapter_count += 1
            continue
        if not chapter.is_stubbed:
            chapter.is_stubbed = True
            chapter.stubbed_at = now
            changed_numbers.add(chapter.chapter_number)

    serial.total_chapters = max(next_number - 1, 0)
    serial.live_chapter_count = live_chapter_count + new_count

    return new_count, changed_numbers


# ---------------------------------------------------------------------------
# Serial CRUD
# ---------------------------------------------------------------------------


async def add_serial(
    session: AsyncSession,
    data: SerialCreate,
) -> WebSerial:
    # Check for duplicates
    existing = await session.scalar(select(WebSerial).where(WebSerial.url == data.url))
    if existing is not None:
        raise SerialAlreadyExists(f"Serial with URL {data.url!r} already exists")

    if data.adapter:
        adapter = get_adapter_by_name(data.adapter)
        if adapter is None:
            raise ScrapingError(f"Unknown adapter: {data.adapter!r}")
    else:
        adapter = get_adapter(data.url)
        if adapter is None:
            raise ScrapingError(f"No scraping adapter supports URL: {data.url!r}")

    # Fetch metadata + chapter list
    try:
        metadata = await adapter.fetch_metadata(data.url)
        chapters = await adapter.fetch_chapter_list(data.url)
    except Exception as exc:
        raise ScrapingError(f"Failed to fetch serial from {data.url!r}: {exc}") from exc

    # Auto-create a Series for this serial's generated volumes
    series = Series(name=metadata.title, description=metadata.description)
    session.add(series)
    await session.flush()  # get series.id

    # Download cover
    cover_path: str | None = None
    if metadata.cover_url:
        dest = _covers_dir() / f"serial_{series.id}.jpg"
        if await _download_cover(metadata.cover_url, dest):
            cover_path = str(dest)

    serial = WebSerial(
        url=data.url,
        source=adapter.name,
        title=metadata.title,
        author=metadata.author,
        description=metadata.description,
        cover_path=cover_path,
        cover_url=metadata.cover_url,
        status=metadata.status,
        total_chapters=0,
        live_chapter_count=0,
        last_checked_at=datetime.now(UTC),
        series_id=series.id,
    )
    session.add(serial)
    await session.flush()  # get serial.id

    await _sync_remote_chapter_list(session, serial, chapters)

    await session.commit()
    await session.refresh(serial)
    return serial


async def list_serials(session: AsyncSession) -> list[WebSerial]:
    result = await session.execute(select(WebSerial).order_by(WebSerial.created_at.desc()))
    return list(result.scalars().all())


async def get_serial(session: AsyncSession, serial_id: int) -> WebSerial:
    serial = await session.scalar(
        select(WebSerial)
        .where(WebSerial.id == serial_id)
        .options(selectinload(WebSerial.chapters), selectinload(WebSerial.volumes))
    )
    if serial is None:
        raise SerialNotFound(f"Serial {serial_id} not found")
    return serial


async def update_serial(session: AsyncSession, serial_id: int, data: SerialUpdate) -> WebSerial:
    serial = await get_serial(session, serial_id)
    if data.title is not None:
        serial.title = data.title
    if data.author is not None:
        serial.author = data.author
    if data.description is not None:
        serial.description = data.description
    if data.status is not None:
        serial.status = data.status
    await session.commit()
    await session.refresh(serial)
    return serial


async def delete_serial(session: AsyncSession, serial_id: int, delete_files: bool = False) -> None:
    serial = await get_serial(session, serial_id)
    if delete_files and serial.cover_path:
        try:
            Path(serial.cover_path).unlink(missing_ok=True)
        except Exception:
            pass
    await session.delete(serial)
    await session.commit()


# ---------------------------------------------------------------------------
# Chapter fetching
# ---------------------------------------------------------------------------


async def list_chapters(
    session: AsyncSession,
    serial_id: int,
    offset: int = 0,
    limit: int = 100,
) -> list[SerialChapter]:
    await _require_serial(session, serial_id)
    result = await session.execute(
        select(SerialChapter)
        .where(SerialChapter.serial_id == serial_id)
        .order_by(SerialChapter.chapter_number)
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def list_chapter_responses(
    session: AsyncSession,
    serial_id: int,
    offset: int = 0,
    limit: int = 100,
) -> list[ChapterResponse]:
    await _require_serial(session, serial_id)

    result = await session.execute(
        select(SerialChapter)
        .where(SerialChapter.serial_id == serial_id)
        .order_by(SerialChapter.chapter_number)
        .limit(offset + limit)
    )
    chapters = list(result.scalars().all())

    running_word_count = 0
    running_is_partial = False
    responses: list[ChapterResponse] = []

    for chapter in chapters:
        if chapter.word_count is None:
            running_is_partial = True
        else:
            running_word_count += chapter.word_count

        responses.append(
            ChapterResponse.from_orm(
                chapter,
                estimated_pages=_estimate_pages(chapter.word_count),
                running_word_count=running_word_count,
                running_estimated_pages=_estimate_pages(running_word_count),
                running_is_partial=running_is_partial,
            )
        )

    return responses[offset : offset + limit]


async def start_chapter_fetch_job(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    serial_id: int,
    start: int,
    end: int,
) -> ChapterFetchJobResponse:
    await _ensure_no_conflicting_pending_batch(serial_id)
    serial = await get_serial(session, serial_id)
    adapter = get_adapter_by_name(serial.source)
    if adapter is None:
        raise ScrapingError(f"No adapter named {serial.source!r} for serial URL: {serial.url!r}")

    total = await session.scalar(
        select(sa_func.count())
        .select_from(SerialChapter)
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= start,
            SerialChapter.chapter_number <= end,
        )
    )

    job = await _schedule_chapter_fetch_job(
        session_factory,
        serial_id=serial_id,
        start=start,
        end=end,
        total=int(total or 0),
        chapter_numbers=None,
    )
    return job.to_job_response()


async def _schedule_chapter_fetch_job(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    serial_id: int,
    start: int,
    end: int,
    total: int,
    chapter_numbers: Sequence[int] | None,
) -> _ChapterFetchJob:
    normalized_numbers = tuple(chapter_numbers) if chapter_numbers is not None else None

    async with _chapter_fetch_jobs_lock:
        existing = _chapter_fetch_jobs.get(serial_id)
        if existing is not None and _job_snapshot_expired(existing):
            del _chapter_fetch_jobs[serial_id]
            existing = None
        if existing is not None and existing.state == "running":
            raise ChapterFetchAlreadyRunning(
                f"A chapter fetch is already running for serial {serial_id}"
            )

        job = _ChapterFetchJob(
            serial_id=serial_id,
            start=start,
            end=end,
            total=total,
            chapter_numbers=normalized_numbers,
        )
        _chapter_fetch_jobs[serial_id] = job

    job.task = asyncio.create_task(_run_chapter_fetch_job(session_factory, job))
    return job


async def get_chapter_fetch_status(
    session: AsyncSession,
    serial_id: int,
) -> ChapterFetchStatusResponse:
    await _require_serial(session, serial_id)

    async with _chapter_fetch_jobs_lock:
        job = _chapter_fetch_jobs.get(serial_id)
        if job is not None and _job_snapshot_expired(job):
            del _chapter_fetch_jobs[serial_id]
            job = None
        if job is None:
            return ChapterFetchStatusResponse(serial_id=serial_id, state="idle")
        return job.to_status_response()


async def get_serial_fetch_state(serial_id: int) -> str:
    async with _chapter_fetch_jobs_lock:
        job = _chapter_fetch_jobs.get(serial_id)
        if job is not None and _job_snapshot_expired(job):
            del _chapter_fetch_jobs[serial_id]
            job = None
        if job is None:
            return "idle"
        return job.state


async def fetch_pending_chapters(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    serial_id: int,
) -> PendingChapterFetchResponse:
    await _ensure_no_conflicting_pending_batch(serial_id)
    await _ensure_no_running_chapter_fetch_job(serial_id)
    result = await update_from_source(session, serial_id)
    pending_numbers = await _list_pending_chapter_numbers(session, serial_id)
    if not pending_numbers:
        return PendingChapterFetchResponse(
            status="noop",
            new_chapters=result["new_chapters"],
            pending_count=0,
            job=None,
        )

    job = await _schedule_chapter_fetch_job(
        session_factory,
        serial_id=serial_id,
        start=min(pending_numbers),
        end=max(pending_numbers),
        total=len(pending_numbers),
        chapter_numbers=pending_numbers,
    )
    return PendingChapterFetchResponse(
        status="started",
        new_chapters=result["new_chapters"],
        pending_count=len(pending_numbers),
        job=job.to_job_response(),
    )


async def _run_chapter_fetch_job(
    session_factory: async_sessionmaker[AsyncSession],
    job: _ChapterFetchJob,
) -> None:
    reporter = _ChapterFetchProgressReporter(job)
    try:
        async with session_factory() as session:
            await fetch_chapters_content(
                session,
                job.serial_id,
                job.start,
                job.end,
                progress=reporter,
                chapter_numbers=job.chapter_numbers,
            )
        await reporter.mark_completed()
    except Exception as exc:
        log.exception("Chapter fetch job failed for serial %d", job.serial_id)
        await reporter.mark_error(str(exc))


async def fetch_chapters_content(
    session: AsyncSession,
    serial_id: int,
    start: int,
    end: int,
    progress: _ChapterFetchProgressReporter | None = None,
    chapter_numbers: Sequence[int] | None = None,
) -> list[SerialChapter]:
    serial = await get_serial(session, serial_id)
    adapter = get_adapter_by_name(serial.source)
    if adapter is None:
        raise ScrapingError(f"No adapter named {serial.source!r} for serial URL: {serial.url!r}")

    chapter_query = select(SerialChapter).where(SerialChapter.serial_id == serial_id)
    if chapter_numbers is None:
        chapter_query = chapter_query.where(
            SerialChapter.chapter_number >= start,
            SerialChapter.chapter_number <= end,
        )
    else:
        chapter_query = chapter_query.where(SerialChapter.chapter_number.in_(list(chapter_numbers)))

    result = await session.execute(chapter_query.order_by(SerialChapter.chapter_number))
    chapters = list(result.scalars().all())

    fetched: list[SerialChapter] = []
    log.info(
        "Fetching content for chapters %d–%d of serial %d (%d to fetch)",
        start,
        end,
        serial_id,
        len(chapters),
    )
    if progress is not None:
        await progress.mark_started()

    newly_fetched_numbers: set[int] = set()
    for chapter in chapters:
        if chapter.content is not None:
            fetched.append(chapter)
            if progress is not None:
                await progress.mark_chapter_skipped(chapter)
            continue
        if chapter.is_stubbed:
            message = "chapter is stubbed upstream and has no cached content"
            log.warning("Skipping stubbed chapter %d: %s", chapter.chapter_number, message)
            if progress is not None:
                await progress.mark_chapter_failed(chapter, message)
            continue
        try:
            log.info("Fetching chapter %d: %s", chapter.chapter_number, chapter.source_url)
            if progress is not None:
                await progress.mark_chapter_started(chapter)
            content = await adapter.fetch_chapter_content(chapter.source_url)
            chapter.content = content.html_content
            chapter.word_count = content.word_count
            chapter.fetched_at = datetime.now(UTC)
            if content.title and not chapter.title:
                chapter.title = content.title
            fetched.append(chapter)
            newly_fetched_numbers.add(chapter.chapter_number)
            await session.commit()
            if progress is not None:
                await progress.mark_chapter_fetched(chapter)
            log.info("Chapter %d fetched (%d words)", chapter.chapter_number, content.word_count)
        except Exception as exc:
            log.warning("Failed to fetch chapter %d: %s", chapter.chapter_number, exc)
            serial.last_error = str(exc)
            serial.status = "error"
            await session.commit()
            if progress is not None:
                await progress.mark_chapter_failed(chapter, str(exc))

    if newly_fetched_numbers:
        await _mark_generated_volumes_stale(session, serial_id, newly_fetched_numbers)
        await session.commit()
    return fetched


# ---------------------------------------------------------------------------
# Update from source
# ---------------------------------------------------------------------------


async def update_from_source(session: AsyncSession, serial_id: int) -> dict:
    serial = await get_serial(session, serial_id)
    adapter = get_adapter_by_name(serial.source)
    if adapter is None:
        raise ScrapingError(f"No adapter named {serial.source!r} for serial URL: {serial.url!r}")

    try:
        chapters = await adapter.fetch_chapter_list(serial.url)
    except Exception as exc:
        serial.last_error = str(exc)
        serial.status = "error"
        await session.commit()
        raise ScrapingError(str(exc)) from exc

    new_count, changed_numbers = await _sync_remote_chapter_list(session, serial, chapters)
    serial.last_checked_at = datetime.now(UTC)
    serial.last_error = None
    if serial.status == "error":
        serial.status = "ongoing"

    await _mark_generated_volumes_stale(session, serial_id, changed_numbers)

    await session.commit()
    return {"new_chapters": new_count, "total_chapters": serial.total_chapters}


# ---------------------------------------------------------------------------
# Volume configuration
# ---------------------------------------------------------------------------


async def configure_volumes(
    session: AsyncSession, serial_id: int, data: VolumeConfigCreate
) -> list[SerialVolume]:
    await _require_serial(session, serial_id)

    # Delete existing unconfigured (no book_id) volumes
    existing_result = await session.execute(
        select(SerialVolume).where(SerialVolume.serial_id == serial_id)
    )
    max_existing = 0
    for vol in existing_result.scalars().all():
        if vol.book_id is None:
            await session.delete(vol)
        else:
            max_existing = max(max_existing, vol.volume_number)
    await session.flush()  # ensure deletions are visible before new inserts

    volumes: list[SerialVolume] = []
    for idx, split in enumerate(data.splits):
        vol = SerialVolume(
            serial_id=serial_id,
            volume_number=max_existing + idx + 1,
            name=split.name,
            chapter_start=split.start,
            chapter_end=split.end,
        )
        session.add(vol)
        volumes.append(vol)

    await session.commit()
    for vol in volumes:
        await session.refresh(vol)
    return volumes


async def auto_split_volumes(
    session: AsyncSession, serial_id: int, config: AutoSplitConfig
) -> list[SerialVolume]:
    serial = await get_serial(session, serial_id)
    if serial.total_chapters == 0:
        return []

    n = config.chapters_per_volume
    splits: list[VolumeRange] = []
    start = 1
    while start <= serial.total_chapters:
        end = min(start + n - 1, serial.total_chapters)
        splits.append(VolumeRange(start=start, end=end))
        start = end + 1

    return await configure_volumes(session, serial_id, VolumeConfigCreate(splits=splits))


async def list_volumes(session: AsyncSession, serial_id: int) -> list[SerialVolume]:
    await _require_serial(session, serial_id)
    result = await session.execute(
        select(SerialVolume)
        .where(SerialVolume.serial_id == serial_id)
        .order_by(SerialVolume.volume_number)
    )
    return list(result.scalars().all())


async def update_volume(
    session: AsyncSession, serial_id: int, volume_id: int, data: VolumeUpdate
) -> SerialVolume:
    vol = await _get_volume(session, serial_id, volume_id)
    if data.name is not None:
        vol.name = data.name
    await session.commit()
    await session.refresh(vol)
    return vol


async def upload_serial_cover(
    session: AsyncSession, serial_id: int, image_bytes: bytes, suffix: str
) -> WebSerial:
    serial = await get_serial(session, serial_id)
    dest = _covers_dir() / f"serial_{serial_id}{suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(image_bytes)
    serial.cover_path = str(dest)
    await session.commit()
    await session.refresh(serial)
    return serial


async def refresh_serial_cover(session: AsyncSession, serial_id: int) -> WebSerial:
    serial = await get_serial(session, serial_id)
    if serial.cover_url is None:
        raise ValueError("Serial has no cover_url to refresh from")
    suffix = Path(serial.cover_url.split("?")[0]).suffix or ".jpg"
    dest = _covers_dir() / f"serial_{serial_id}{suffix}"
    await _download_cover(serial.cover_url, dest)
    serial.cover_path = str(dest)
    await session.commit()
    await session.refresh(serial)
    return serial


async def upload_volume_cover(
    session: AsyncSession, serial_id: int, volume_id: int, image_bytes: bytes, suffix: str
) -> SerialVolume:
    vol = await _get_volume(session, serial_id, volume_id)
    dest = _covers_dir() / f"serial_vol_{volume_id}{suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(image_bytes)
    vol.cover_path = str(dest)
    await session.commit()
    await session.refresh(vol)
    return vol


# ---------------------------------------------------------------------------
# Volume generation
# ---------------------------------------------------------------------------


async def generate_volume(
    session: AsyncSession,
    serial_id: int,
    volume_id: int,
    shelf_id: int | None = None,
    existing_book_id: str | None = None,
) -> SerialVolume:
    from app.services.epub_builder import build_volume_epub

    serial = await get_serial(session, serial_id)
    vol = await _get_volume(session, serial_id, volume_id)

    # Snapshot scalar values before any commits expire these ORM objects.
    chapter_start = vol.chapter_start
    chapter_end = vol.chapter_end
    vol_number = vol.volume_number
    series_id = serial.series_id

    log.info(
        "Generating volume %d (ch %d–%d) for serial %d",
        vol_number,
        chapter_start,
        chapter_end,
        serial_id,
    )

    # Ensure all chapters in range are fetched (commits internally).
    await fetch_chapters_content(session, serial_id, chapter_start, chapter_end)

    # Re-fetch serial/vol after the commit above expired them.
    serial = await get_serial(session, serial_id)
    vol = await _get_volume(session, serial_id, volume_id)

    chapters_result = await session.execute(
        select(SerialChapter)
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= chapter_start,
            SerialChapter.chapter_number <= chapter_end,
            SerialChapter.content.isnot(None),
        )
        .order_by(SerialChapter.chapter_number)
    )
    chapters = list(chapters_result.scalars().all())
    if not chapters:
        raise VolumeGenerationError(f"No fetched chapters in range {chapter_start}–{chapter_end}")

    # Determine output shelf
    from app.models.shelf import Shelf

    if shelf_id is not None:
        shelf = await session.scalar(select(Shelf).where(Shelf.id == shelf_id))
        if shelf is None:
            raise VolumeGenerationError(f"Shelf {shelf_id} not found")
    else:
        from app.config import get_settings

        settings = get_settings()
        shelf = await session.scalar(select(Shelf).where(Shelf.name == settings.default_shelf_name))
        if shelf is None:
            shelf = Shelf(name=settings.default_shelf_name, path=settings.default_shelf_path)
            session.add(shelf)
            await session.flush()

    # Always write the EPUB into the shelf's actual path.
    output_dir = Path(shelf.path)
    output_dir.mkdir(parents=True, exist_ok=True)

    log.info(
        "Building EPUB for volume %d (%d chapters) → %s",
        vol_number,
        len(chapters),
        output_dir,
    )
    try:
        epub_path = await build_volume_epub(serial, vol, chapters, output_dir, existing_book_id)
    except Exception as exc:
        log.exception("EPUB generation failed for volume %d: %s", vol_number, exc)
        raise VolumeGenerationError(f"EPUB generation failed: {exc}") from exc

    log.info("EPUB written: %s", epub_path)

    # Snapshot shelf scalars before _process_file commits (which expires shelf).
    shelf_id_snap = shelf.id
    shelf_path_snap = shelf.path

    # Create or update Book row (_process_file commits internally).
    from app.services.import_service import _process_file

    covers_dir = _covers_dir()
    await _process_file(session, shelf, epub_path, covers_dir)  # type: ignore[arg-type]

    # Find the book we just created/updated.
    # _process_file stores file_path as relative to shelf.path.
    from app.models.book import Book

    rel_epub_path = str(epub_path.relative_to(shelf_path_snap))
    book = await session.scalar(
        select(Book)
        .where(Book.shelf_id == shelf_id_snap, Book.file_path == rel_epub_path)
        .order_by(Book.date_added.desc())
    )
    if book is None:
        raise VolumeGenerationError("Book record was not created after EPUB import")

    # Re-fetch vol after _process_file's commit expired it.
    vol = await _get_volume(session, serial_id, volume_id)

    # Link volume to book
    vol.book_id = book.id
    vol.generated_at = datetime.now(UTC)
    vol.is_stale = False

    # Add book to serial's series
    if series_id is not None:
        existing_entry = await session.scalar(
            select(BookSeries).where(
                BookSeries.book_id == book.id, BookSeries.series_id == series_id
            )
        )
        if existing_entry is None:
            session.add(
                BookSeries(
                    book_id=book.id,
                    series_id=series_id,
                    sequence=float(vol_number),
                )
            )

    await session.commit()
    await session.refresh(vol)
    return vol


async def generate_all_volumes(
    session: AsyncSession, serial_id: int, shelf_id: int | None = None
) -> list[SerialVolume]:
    volumes = await list_volumes(session, serial_id)
    # Snapshot ids before generate_volume commits expire these objects.
    volume_ids = [(vol.id, vol.volume_number) for vol in volumes]
    results: list[SerialVolume] = []
    for vol_id, vol_num in volume_ids:
        try:
            generated = await generate_volume(session, serial_id, vol_id, shelf_id)
            results.append(generated)
        except VolumeGenerationError as exc:
            log.warning("Volume %d generation failed: %s", vol_num, exc)
    return results


async def rebuild_volume(session: AsyncSession, serial_id: int, volume_id: int) -> SerialVolume:
    vol = await _get_volume(session, serial_id, volume_id)
    shelf_id: int | None = None
    existing_book_id: str | None = None
    if vol.book_id is not None:
        from app.models.book import Book

        existing_book_id = vol.book_id
        book = await session.scalar(select(Book).where(Book.id == vol.book_id))
        if book is not None:
            shelf_id = book.shelf_id
    return await generate_volume(session, serial_id, volume_id, shelf_id, existing_book_id)


# ---------------------------------------------------------------------------
# Volume deletion & single add
# ---------------------------------------------------------------------------


class VolumeNotFound(Exception):
    pass


async def delete_volume(
    session: AsyncSession,
    serial_id: int,
    volume_id: int,
    delete_book: bool = False,
) -> None:
    vol = await _get_volume(session, serial_id, volume_id)
    if delete_book and vol.book_id is not None:
        from app.models.book import Book

        book = await session.scalar(select(Book).where(Book.id == vol.book_id))
        if book is not None:
            # Delete file from disk
            from app.models.shelf import Shelf

            shelf = await session.scalar(select(Shelf).where(Shelf.id == book.shelf_id))
            if shelf is not None and book.file_path:
                file_path = Path(shelf.path) / book.file_path
                try:
                    file_path.unlink(missing_ok=True)
                except Exception:
                    pass
            await session.delete(book)

    await session.delete(vol)
    await session.commit()


async def add_single_volume(
    session: AsyncSession,
    serial_id: int,
    data: SingleVolumeCreate,
) -> SerialVolume:
    await _require_serial(session, serial_id)

    # Find max existing volume number
    result = await session.execute(
        select(sa_func.max(SerialVolume.volume_number)).where(SerialVolume.serial_id == serial_id)
    )
    max_num = result.scalar() or 0

    vol = SerialVolume(
        serial_id=serial_id,
        volume_number=max_num + 1,
        name=data.name,
        chapter_start=data.start,
        chapter_end=data.end,
    )
    session.add(vol)
    await session.commit()
    await session.refresh(vol)
    return vol


# ---------------------------------------------------------------------------
# Word count / page estimation
# ---------------------------------------------------------------------------


async def get_volume_metrics(session: AsyncSession, serial_id: int) -> dict[int, VolumeMetrics]:
    """Return derived metrics for all configured volumes of a serial."""
    volumes = await list_volumes(session, serial_id)
    if not volumes:
        return {}

    min_chapter = min(volume.chapter_start for volume in volumes)
    max_chapter = max(volume.chapter_end for volume in volumes)
    result = await session.execute(
        select(
            SerialChapter.chapter_number,
            SerialChapter.word_count,
            SerialChapter.content,
            SerialChapter.is_stubbed,
        )
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= min_chapter,
            SerialChapter.chapter_number <= max_chapter,
        )
        .order_by(SerialChapter.chapter_number)
    )
    chapter_data = {
        int(row[0]): {
            "word_count": row[1],
            "has_content": row[2] is not None,
            "is_stubbed": bool(row[3]),
        }
        for row in result.all()
    }

    metrics: dict[int, VolumeMetrics] = {}
    for volume in volumes:
        total_words = 0
        fetched_chapter_count = 0
        stubbed_missing_count = 0
        is_partial = False

        for chapter_number in range(volume.chapter_start, volume.chapter_end + 1):
            data = chapter_data.get(chapter_number)
            if data is None or data["word_count"] is None:
                is_partial = True
                if data is not None and data["is_stubbed"] and not data["has_content"]:
                    stubbed_missing_count += 1
                continue
            fetched_chapter_count += 1
            total_words += int(data["word_count"])

        metrics[volume.id] = VolumeMetrics(
            total_words=total_words,
            fetched_chapter_count=fetched_chapter_count,
            chapter_count=max(0, volume.chapter_end - volume.chapter_start + 1),
            is_partial=is_partial,
            stubbed_missing_count=stubbed_missing_count,
        )

    return metrics


async def get_volume_word_counts(session: AsyncSession, serial_id: int) -> dict[int, int]:
    metrics = await get_volume_metrics(session, serial_id)
    return {volume_id: metric.total_words for volume_id, metric in metrics.items()}


async def preview_volume_ranges(
    session: AsyncSession,
    serial_id: int,
    splits: list[VolumeRange],
) -> list[VolumePreviewResponse]:
    await _require_serial(session, serial_id)

    if not splits:
        return []

    min_chapter = min(split.start for split in splits)
    max_chapter = max(split.end for split in splits)
    result = await session.execute(
        select(
            SerialChapter.chapter_number,
            SerialChapter.word_count,
            SerialChapter.content,
            SerialChapter.is_stubbed,
        )
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= min_chapter,
            SerialChapter.chapter_number <= max_chapter,
        )
        .order_by(SerialChapter.chapter_number)
    )
    chapter_word_counts = {int(row[0]): (row[1], row[2], bool(row[3])) for row in result.all()}

    previews: list[VolumePreviewResponse] = []
    for split in splits:
        chapter_numbers = range(split.start, split.end + 1)
        total_words = 0
        fetched_chapter_count = 0
        is_partial = False
        stubbed_missing_count = 0

        for chapter_number in chapter_numbers:
            row = chapter_word_counts.get(chapter_number)
            word_count = row[0] if row is not None else None
            if word_count is None:
                is_partial = True
                if row is not None and row[2] and row[1] is None:
                    stubbed_missing_count += 1
                continue
            fetched_chapter_count += 1
            total_words += int(word_count)

        chapter_count = max(0, split.end - split.start + 1)
        previews.append(
            VolumePreviewResponse(
                start=split.start,
                end=split.end,
                name=split.name,
                chapter_count=chapter_count,
                fetched_chapter_count=fetched_chapter_count,
                total_words=total_words,
                estimated_pages=_estimate_pages(total_words),
                is_partial=is_partial,
                stubbed_missing_count=stubbed_missing_count,
            )
        )

    return previews


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _estimate_pages(word_count: int | None) -> int | None:
    if word_count is None or word_count <= 0:
        return None
    return max(1, word_count // _WORDS_PER_PAGE)


def reset_chapter_fetch_jobs() -> None:
    global _pending_chapter_batch_job
    for job in _chapter_fetch_jobs.values():
        if job.task is not None and not job.task.done():
            job.task.cancel()
    _chapter_fetch_jobs.clear()
    if _pending_chapter_batch_job is not None:
        if (
            _pending_chapter_batch_job.task is not None
            and not _pending_chapter_batch_job.task.done()
        ):
            _pending_chapter_batch_job.task.cancel()
        _pending_chapter_batch_job = None


def _job_snapshot_expired(job: _ChapterFetchJob) -> bool:
    return (
        job.state != "running"
        and job.finished_at is not None
        and (datetime.now(UTC) - job.finished_at).total_seconds() > _FETCH_JOB_RETENTION_SECONDS
    )


def _batch_snapshot_expired(job: _PendingChapterBatchJob) -> bool:
    return (
        job.state != "running"
        and job.finished_at is not None
        and (datetime.now(UTC) - job.finished_at).total_seconds() > _FETCH_JOB_RETENTION_SECONDS
    )


async def _get_pending_chapter_batch_job() -> _PendingChapterBatchJob | None:
    global _pending_chapter_batch_job
    async with _pending_chapter_batch_job_lock:
        if _pending_chapter_batch_job is not None and _batch_snapshot_expired(
            _pending_chapter_batch_job
        ):
            _pending_chapter_batch_job = None
        return _pending_chapter_batch_job


async def _ensure_no_conflicting_pending_batch(serial_id: int) -> None:
    batch = await _get_pending_chapter_batch_job()
    if batch is None or batch.state != "running":
        return
    if batch.current_serial_id == serial_id:
        return
    raise ChapterFetchBatchBusy("A pending chapter batch is already running")


async def _get_eligible_dashboard_serial_ids(
    session_factory: async_sessionmaker[AsyncSession],
) -> list[int]:
    async with session_factory() as session:
        result = await session.execute(
            select(WebSerial.id)
            .where(WebSerial.status.in_(["ongoing", "error"]))
            .order_by(WebSerial.last_checked_at.desc().nullslast())
        )
        return list(result.scalars().all())


async def _list_pending_chapter_numbers(
    session: AsyncSession,
    serial_id: int,
) -> list[int]:
    result = await session.execute(
        select(SerialChapter.chapter_number)
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.content.is_(None),
            SerialChapter.is_stubbed.is_(False),
        )
        .order_by(SerialChapter.chapter_number)
    )
    return list(result.scalars().all())


async def _ensure_no_running_chapter_fetch_job(serial_id: int) -> None:
    async with _chapter_fetch_jobs_lock:
        existing = _chapter_fetch_jobs.get(serial_id)
        if existing is not None and _job_snapshot_expired(existing):
            del _chapter_fetch_jobs[serial_id]
            existing = None
        if existing is not None and existing.state == "running":
            raise ChapterFetchAlreadyRunning(
                f"A chapter fetch is already running for serial {serial_id}"
            )


# ---------------------------------------------------------------------------
# Serial update checking
# ---------------------------------------------------------------------------


async def check_serial_for_updates(session: AsyncSession, serial: WebSerial) -> int:
    """Re-fetch chapter list for a serial and insert any new chapters.

    Returns the number of new chapters found.
    """
    adapter = get_adapter_by_name(serial.source)
    if adapter is None:
        serial.status = "error"
        serial.last_error = f"No adapter named {serial.source!r}"
        serial.last_checked_at = datetime.now(UTC)
        await session.commit()
        return 0

    try:
        remote_chapters = await adapter.fetch_chapter_list(serial.url)
    except Exception as exc:
        serial.status = "error"
        serial.last_error = str(exc)
        serial.last_checked_at = datetime.now(UTC)
        await session.commit()
        log.warning("Failed to fetch chapter list for serial %d: %s", serial.id, exc)
        return 0

    new_count, changed_numbers = await _sync_remote_chapter_list(session, serial, remote_chapters)
    serial.last_checked_at = datetime.now(UTC)
    serial.last_error = None
    if serial.status == "error":
        serial.status = "ongoing"

    await _mark_generated_volumes_stale(session, serial.id, changed_numbers)
    await session.commit()

    if new_count > 0:
        log.info("Serial %d (%s): found %d new chapters", serial.id, serial.title, new_count)
    return new_count


async def check_all_serials_for_updates(
    session_factory: async_sessionmaker[AsyncSession],
) -> dict[str, int]:
    """Check all non-paused serials for new chapters.

    Returns dict with 'checked' and 'new_chapters' counts.
    """
    async with session_factory() as session:
        result = await session.execute(select(WebSerial).where(WebSerial.status == "ongoing"))
        serials = list(result.scalars().all())

    total_new = 0
    for serial in serials:
        async with session_factory() as session:
            # Re-fetch to get attached instance
            s = await session.scalar(select(WebSerial).where(WebSerial.id == serial.id))
            if s is not None:
                total_new += await check_serial_for_updates(session, s)

    return {"checked": len(serials), "new_chapters": total_new}


async def start_pending_chapter_batch(
    session_factory: async_sessionmaker[AsyncSession],
) -> PendingChapterBatchStatusResponse:
    global _pending_chapter_batch_job

    serial_ids = await _get_eligible_dashboard_serial_ids(session_factory)

    async with _pending_chapter_batch_job_lock:
        if _pending_chapter_batch_job is not None and _batch_snapshot_expired(
            _pending_chapter_batch_job
        ):
            _pending_chapter_batch_job = None
        if _pending_chapter_batch_job is not None and _pending_chapter_batch_job.state == "running":
            raise PendingChapterBatchAlreadyRunning("A pending chapter batch is already running")

        job = _PendingChapterBatchJob(total_serials=len(serial_ids))
        _pending_chapter_batch_job = job

    job.task = asyncio.create_task(_run_pending_chapter_batch(session_factory, job, serial_ids))
    return job.to_status_response()


async def get_pending_chapter_batch_status() -> PendingChapterBatchStatusResponse:
    job = await _get_pending_chapter_batch_job()
    if job is None:
        return PendingChapterBatchStatusResponse(state="idle")
    return job.to_status_response()


async def _set_pending_batch_current_serial(
    job: _PendingChapterBatchJob,
    serial_id: int | None,
) -> None:
    async with _pending_chapter_batch_job_lock:
        job.current_serial_id = serial_id


async def _increment_pending_batch_counter(
    job: _PendingChapterBatchJob,
    *,
    started: int = 0,
    already_running: int = 0,
    noop: int = 0,
    failed: int = 0,
    new_chapters: int = 0,
    processed_serials: int = 0,
) -> None:
    async with _pending_chapter_batch_job_lock:
        job.started += started
        job.already_running += already_running
        job.noop += noop
        job.failed += failed
        job.new_chapters += new_chapters
        job.processed_serials += processed_serials


async def _mark_pending_batch_completed(job: _PendingChapterBatchJob) -> None:
    async with _pending_chapter_batch_job_lock:
        job.state = "completed"
        job.current_serial_id = None
        job.finished_at = datetime.now(UTC)


async def _mark_pending_batch_error(job: _PendingChapterBatchJob, error: str) -> None:
    async with _pending_chapter_batch_job_lock:
        job.state = "error"
        job.error = error
        job.current_serial_id = None
        job.finished_at = datetime.now(UTC)


async def _run_pending_chapter_batch(
    session_factory: async_sessionmaker[AsyncSession],
    job: _PendingChapterBatchJob,
    serial_ids: list[int],
) -> None:
    try:
        for serial_id in serial_ids:
            await _set_pending_batch_current_serial(job, serial_id)
            try:
                async with session_factory() as session:
                    result = await fetch_pending_chapters(session, session_factory, serial_id)
            except ChapterFetchAlreadyRunning:
                await _increment_pending_batch_counter(
                    job,
                    already_running=1,
                    processed_serials=1,
                )
                continue
            except Exception:
                log.exception("Pending chapter batch failed for serial %d", serial_id)
                await _increment_pending_batch_counter(job, failed=1, processed_serials=1)
                continue

            await _increment_pending_batch_counter(job, new_chapters=result.new_chapters)
            if result.status == "noop":
                await _increment_pending_batch_counter(job, noop=1, processed_serials=1)
                continue

            await _increment_pending_batch_counter(job, started=1)

            running_job = None
            async with _chapter_fetch_jobs_lock:
                running_job = _chapter_fetch_jobs.get(serial_id)
                if running_job is not None and _job_snapshot_expired(running_job):
                    del _chapter_fetch_jobs[serial_id]
                    running_job = None

            if running_job is not None and running_job.task is not None:
                await running_job.task

            await _increment_pending_batch_counter(job, processed_serials=1)

        await _mark_pending_batch_completed(job)
    except Exception as exc:
        log.exception("Pending chapter batch failed")
        await _mark_pending_batch_error(job, str(exc))


async def acknowledge_serial(session: AsyncSession, serial_id: int) -> None:
    """Mark a serial as viewed, clearing the 'new chapters' indicator."""
    serial = await session.scalar(select(WebSerial).where(WebSerial.id == serial_id))
    if serial is None:
        raise SerialNotFound(f"Serial {serial_id} not found")
    serial.last_viewed_at = datetime.now(UTC)
    await session.commit()


@dataclass
class SerialDashboardEntry:
    id: int
    title: str | None
    author: str | None
    cover_path: str | None
    status: str
    total_chapters: int
    live_chapter_count: int
    stubbed_chapter_count: int
    fetched_count: int
    new_chapter_count: int
    latest_chapter_title: str | None
    latest_chapter_date: datetime | None
    last_checked_at: datetime | None
    fetch_state: str


async def list_serials_for_dashboard(
    session: AsyncSession,
) -> list[SerialDashboardEntry]:
    """Return ongoing/error serials with new-chapter counts for the dashboard widget."""
    result = await session.execute(
        select(WebSerial)
        .where(WebSerial.status.in_(["ongoing", "error"]))
        .order_by(WebSerial.last_checked_at.desc().nullslast())
    )
    serials = list(result.scalars().all())

    entries: list[SerialDashboardEntry] = []
    for serial in serials:
        # Count new chapters (created after last_viewed_at, or all if never viewed)
        count_q = (
            select(sa_func.count())
            .select_from(SerialChapter)
            .where(
                SerialChapter.serial_id == serial.id,
                SerialChapter.is_stubbed.is_(False),
            )
        )
        if serial.last_viewed_at is not None:
            count_q = count_q.where(SerialChapter.publish_date > serial.last_viewed_at)
        new_count = await session.scalar(count_q) or 0

        # Count fetched chapters (content is not null)
        fetched = (
            await session.scalar(
                select(sa_func.count())
                .select_from(SerialChapter)
                .where(
                    SerialChapter.serial_id == serial.id,
                    SerialChapter.content.isnot(None),
                )
            )
            or 0
        )

        # Get latest chapter
        latest = await session.scalar(
            select(SerialChapter)
            .where(
                SerialChapter.serial_id == serial.id,
                SerialChapter.is_stubbed.is_(False),
            )
            .order_by(SerialChapter.chapter_number.desc())
            .limit(1)
        )

        entries.append(
            SerialDashboardEntry(
                id=serial.id,
                title=serial.title,
                author=serial.author,
                cover_path=serial.cover_path,
                status=serial.status,
                total_chapters=serial.total_chapters,
                live_chapter_count=serial.live_chapter_count,
                stubbed_chapter_count=serial.stubbed_chapter_count,
                fetched_count=fetched,
                new_chapter_count=new_count,
                latest_chapter_title=latest.title if latest else None,
                latest_chapter_date=latest.publish_date if latest else None,
                last_checked_at=serial.last_checked_at,
                fetch_state=await get_serial_fetch_state(serial.id),
            )
        )

    return entries


async def _require_serial(session: AsyncSession, serial_id: int) -> None:
    exists = await session.scalar(select(WebSerial.id).where(WebSerial.id == serial_id))
    if exists is None:
        raise SerialNotFound(f"Serial {serial_id} not found")


async def _get_volume(session: AsyncSession, serial_id: int, volume_id: int) -> SerialVolume:
    vol = await session.scalar(
        select(SerialVolume).where(
            SerialVolume.id == volume_id, SerialVolume.serial_id == serial_id
        )
    )
    if vol is None:
        raise SerialNotFound(f"Volume {volume_id} not found for serial {serial_id}")
    return vol
