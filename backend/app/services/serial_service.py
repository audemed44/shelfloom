"""Serial management service — add, update, delete web serials and their volumes."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.serial import SerialChapter, SerialVolume, WebSerial
from app.models.series import BookSeries, Series
from app.schemas.serial import (
    AutoSplitConfig,
    SerialCreate,
    SerialUpdate,
    VolumeConfigCreate,
    VolumeRange,
    VolumeUpdate,
)
from app.scrapers.registry import get_adapter

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
        total_chapters=len(chapters),
        last_checked_at=datetime.utcnow(),
        series_id=series.id,
    )
    session.add(serial)
    await session.flush()  # get serial.id

    for ch in chapters:
        session.add(
            SerialChapter(
                serial_id=serial.id,
                chapter_number=ch.chapter_number,
                title=ch.title,
                source_url=ch.source_url,
                publish_date=ch.publish_date,
            )
        )

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


async def fetch_chapters_content(
    session: AsyncSession,
    serial_id: int,
    start: int,
    end: int,
) -> list[SerialChapter]:
    serial = await get_serial(session, serial_id)
    adapter = get_adapter(serial.url)
    if adapter is None:
        raise ScrapingError(f"No adapter for serial URL: {serial.url!r}")

    result = await session.execute(
        select(SerialChapter)
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= start,
            SerialChapter.chapter_number <= end,
        )
        .order_by(SerialChapter.chapter_number)
    )
    chapters = list(result.scalars().all())

    fetched: list[SerialChapter] = []
    for chapter in chapters:
        if chapter.content is not None:
            fetched.append(chapter)
            continue
        try:
            content = await adapter.fetch_chapter_content(chapter.source_url)
            chapter.content = content.html_content
            chapter.word_count = content.word_count
            chapter.fetched_at = datetime.utcnow()
            if content.title and not chapter.title:
                chapter.title = content.title
            fetched.append(chapter)
        except Exception as exc:
            log.warning("Failed to fetch chapter %d: %s", chapter.chapter_number, exc)
            serial.last_error = str(exc)
            serial.status = "error"

    # Mark volumes covering fetched chapters as stale
    fetched_numbers = {ch.chapter_number for ch in fetched}
    if fetched_numbers:
        vol_result = await session.execute(
            select(SerialVolume).where(SerialVolume.serial_id == serial_id)
        )
        for vol in vol_result.scalars().all():
            if any(vol.chapter_start <= n <= vol.chapter_end for n in fetched_numbers):
                if vol.generated_at is not None:
                    vol.is_stale = True

    await session.commit()
    return fetched


# ---------------------------------------------------------------------------
# Update from source
# ---------------------------------------------------------------------------


async def update_from_source(session: AsyncSession, serial_id: int) -> dict:
    serial = await get_serial(session, serial_id)
    adapter = get_adapter(serial.url)
    if adapter is None:
        raise ScrapingError(f"No adapter for serial URL: {serial.url!r}")

    try:
        chapters = await adapter.fetch_chapter_list(serial.url)
    except Exception as exc:
        serial.last_error = str(exc)
        serial.status = "error"
        await session.commit()
        raise ScrapingError(str(exc)) from exc

    # Find existing chapter numbers
    existing_result = await session.execute(
        select(SerialChapter.chapter_number).where(SerialChapter.serial_id == serial_id)
    )
    existing_numbers = {row[0] for row in existing_result.all()}

    new_chapters = [ch for ch in chapters if ch.chapter_number not in existing_numbers]
    for ch in new_chapters:
        session.add(
            SerialChapter(
                serial_id=serial_id,
                chapter_number=ch.chapter_number,
                title=ch.title,
                source_url=ch.source_url,
                publish_date=ch.publish_date,
            )
        )

    serial.total_chapters = len(chapters)
    serial.last_checked_at = datetime.utcnow()
    serial.last_error = None
    if serial.status == "error":
        serial.status = "ongoing"

    # Mark volumes as stale if new chapters fall within their range
    if new_chapters:
        new_numbers = {ch.chapter_number for ch in new_chapters}
        vol_result = await session.execute(
            select(SerialVolume).where(
                SerialVolume.serial_id == serial_id,
                SerialVolume.generated_at.isnot(None),
            )
        )
        for vol in vol_result.scalars().all():
            if any(vol.chapter_start <= n <= vol.chapter_end for n in new_numbers):
                vol.is_stale = True

    await session.commit()
    return {"new_chapters": len(new_chapters), "total_chapters": len(chapters)}


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
    for vol in existing_result.scalars().all():
        if vol.book_id is None:
            await session.delete(vol)
    await session.flush()  # ensure deletions are visible before new inserts

    volumes: list[SerialVolume] = []
    for idx, split in enumerate(data.splits):
        vol = SerialVolume(
            serial_id=serial_id,
            volume_number=idx + 1,
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
) -> SerialVolume:
    from app.services.epub_builder import build_volume_epub

    serial = await get_serial(session, serial_id)
    vol = await _get_volume(session, serial_id, volume_id)

    # Ensure all chapters in range are fetched
    await fetch_chapters_content(session, serial_id, vol.chapter_start, vol.chapter_end)

    chapters_result = await session.execute(
        select(SerialChapter)
        .where(
            SerialChapter.serial_id == serial_id,
            SerialChapter.chapter_number >= vol.chapter_start,
            SerialChapter.chapter_number <= vol.chapter_end,
            SerialChapter.content.isnot(None),
        )
        .order_by(SerialChapter.chapter_number)
    )
    chapters = list(chapters_result.scalars().all())
    if not chapters:
        raise VolumeGenerationError(
            f"No fetched chapters in range {vol.chapter_start}–{vol.chapter_end}"
        )

    # Determine output shelf directory
    if shelf_id is None:
        # default shelf
        from app.config import get_settings

        output_dir = Path(get_settings().default_shelf_path)
    else:
        from app.models.shelf import Shelf

        shelf = await session.scalar(select(Shelf).where(Shelf.id == shelf_id))
        if shelf is None:
            raise VolumeGenerationError(f"Shelf {shelf_id} not found")
        output_dir = Path(shelf.path)

    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        epub_path = await build_volume_epub(serial, vol, chapters, output_dir)
    except Exception as exc:
        raise VolumeGenerationError(f"EPUB generation failed: {exc}") from exc

    # Create or update Book row
    from app.services.import_service import _process_file

    if shelf_id is None:
        from app.models.shelf import Shelf

        shelf = await session.scalar(select(Shelf).where(Shelf.path == str(output_dir)))
        if shelf is None:
            # Create a default shelf entry if missing
            from app.config import get_settings

            settings = get_settings()
            shelf = Shelf(name=settings.default_shelf_name, path=str(output_dir))
            session.add(shelf)
            await session.flush()

    covers_dir = _covers_dir()
    await _process_file(session, shelf, epub_path, covers_dir)  # type: ignore[arg-type]

    # Find the book we just created/updated
    from app.models.book import Book

    book = await session.scalar(
        select(Book).where(Book.file_path == str(epub_path)).order_by(Book.date_added.desc())
    )
    if book is None:
        raise VolumeGenerationError("Book record was not created after EPUB import")

    # Link volume to book
    vol.book_id = book.id
    vol.generated_at = datetime.utcnow()
    vol.is_stale = False

    # Add book to serial's series
    if serial.series_id is not None:
        existing_entry = await session.scalar(
            select(BookSeries).where(
                BookSeries.book_id == book.id, BookSeries.series_id == serial.series_id
            )
        )
        if existing_entry is None:
            session.add(
                BookSeries(
                    book_id=book.id,
                    series_id=serial.series_id,
                    sequence=float(vol.volume_number),
                )
            )

    await session.commit()
    await session.refresh(vol)
    return vol


async def generate_all_volumes(
    session: AsyncSession, serial_id: int, shelf_id: int | None = None
) -> list[SerialVolume]:
    volumes = await list_volumes(session, serial_id)
    results: list[SerialVolume] = []
    for vol in volumes:
        try:
            generated = await generate_volume(session, serial_id, vol.id, shelf_id)
            results.append(generated)
        except VolumeGenerationError as exc:
            log.warning("Volume %d generation failed: %s", vol.volume_number, exc)
    return results


async def rebuild_volume(session: AsyncSession, serial_id: int, volume_id: int) -> SerialVolume:
    vol = await _get_volume(session, serial_id, volume_id)
    shelf_id: int | None = None
    if vol.book_id is not None:
        from app.models.book import Book

        book = await session.scalar(select(Book).where(Book.id == vol.book_id))
        if book is not None:
            shelf_id = book.shelf_id
    return await generate_volume(session, serial_id, volume_id, shelf_id)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


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
