"""KOSync protocol service.

Implements the progress-sync server KOReader's built-in "Progress sync" plugin
talks to (see koreader/plugins/kosync.koplugin). Positions are also linked to
library books, so Shelfloom's web reader and KOReader share one position per
book even when the book's file (and so its digest) changes.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import UTC, datetime
from pathlib import PurePath

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookHash
from app.models.kosync import (
    WEB_READER_DEVICE,
    WEB_READER_DEVICE_ID,
    WEB_READER_USERNAME,
    KoSyncProgress,
    KoSyncUser,
)
from app.models.reading import ReadingProgress

log = logging.getLogger(__name__)

_MD5_HEX = re.compile(r"^[0-9a-f]{32}$")


# ── users ─────────────────────────────────────────────────────────────────────
#
# KOReader never sends the password itself: it sends md5(password) as the
# "userkey", both when registering and in the x-auth-key header. We store
# sha256(userkey). Accounts created before this scheme stored sha256(password);
# they still work over Basic auth and are upgraded on their next login.


def _hash_key(userkey: str) -> str:
    return hashlib.sha256(userkey.encode()).hexdigest()


def userkey_for_password(password: str) -> str:
    """The userkey KOReader would send for this password."""
    return hashlib.md5(password.encode()).hexdigest()


def _as_userkey(secret: str) -> str:
    """Registration input from KOReader is already a userkey (32 hex chars)."""
    return secret if _MD5_HEX.match(secret) else userkey_for_password(secret)


async def register_user(session: AsyncSession, username: str, password: str) -> KoSyncUser | None:
    """Register a user. ``password`` may be a plain password or a KOReader userkey.

    Returns None if the username is taken.
    """
    existing = await session.get(KoSyncUser, username)
    if existing is not None:
        return None
    user = KoSyncUser(username=username, password_hash=_hash_key(_as_userkey(password)))
    session.add(user)
    await session.commit()
    return user


async def authenticate_key(session: AsyncSession, username: str, userkey: str) -> KoSyncUser | None:
    """Check KOReader's x-auth-user / x-auth-key credentials."""
    user = await session.get(KoSyncUser, username)
    if user is None or user.password_hash != _hash_key(userkey):
        return None
    return user


async def authenticate_user(
    session: AsyncSession, username: str, password: str
) -> KoSyncUser | None:
    """Check Basic-auth credentials (a plain password, or a userkey)."""
    user = await session.get(KoSyncUser, username)
    if user is None:
        return None
    if user.password_hash == _hash_key(_as_userkey(password)):
        return user
    if user.password_hash == _hash_key(password):
        # Legacy account (sha256 of the plain password): upgrade it so the
        # same account also works from KOReader.
        user.password_hash = _hash_key(userkey_for_password(password))
        await session.commit()
        return user
    return None


async def list_accounts(session: AsyncSession) -> list[dict]:
    """KOReader sync accounts, each with its most recent sync (if any)."""
    usernames = list(
        (await session.execute(select(KoSyncUser.username).order_by(KoSyncUser.username))).scalars()
    )
    accounts = []
    for username in usernames:
        row = (
            await session.execute(
                select(KoSyncProgress, Book.title)
                .outerjoin(Book, Book.id == KoSyncProgress.book_id)
                .where(KoSyncProgress.username == username)
                .order_by(KoSyncProgress.timestamp.desc(), KoSyncProgress.id.desc())
                .limit(1)
            )
        ).first()
        record, title = row if row else (None, None)
        accounts.append(
            {
                "username": username,
                "last_synced_at": record.timestamp if record else None,
                "last_device": record.device if record else None,
                "last_book_title": title,
            }
        )
    return accounts


async def delete_user(session: AsyncSession, username: str) -> bool:
    user = await session.get(KoSyncUser, username)
    if user is None:
        return False
    await session.delete(user)
    await session.commit()
    return True


# ── document → book ───────────────────────────────────────────────────────────


def filename_digest(file_path: str) -> str:
    """KOReader's "filename" document matching: md5 of the file's name."""
    return hashlib.md5(PurePath(file_path).name.encode()).hexdigest()


async def resolve_book_id(session: AsyncSession, document: str) -> str | None:
    """Find the library book a KOReader document digest refers to.

    Checks the book's current partial MD5, then every partial MD5 the book has
    had (KOReader caches the digest from the first time it opened a file, so it
    keeps sending the old one after the file changes), then the filename digest.
    """
    if not document:
        return None
    book_id = await session.scalar(select(Book.id).where(Book.file_hash_md5_ko == document))
    if book_id is not None:
        return book_id
    book_id = await session.scalar(
        select(BookHash.book_id)
        .where(BookHash.hash_md5_ko == document)
        .order_by(BookHash.recorded_at.desc())
        .limit(1)
    )
    if book_id is not None:
        return book_id
    for bid, path in await session.execute(select(Book.id, Book.file_path)):
        if filename_digest(path) == document:
            return bid
    return None


# ── progress ──────────────────────────────────────────────────────────────────


def _now_ts() -> int:
    return int(datetime.now(tz=UTC).timestamp())


def _normalise_percentage(value: float) -> float:
    """KOReader sends 0–1. Accept 0–100 from older clients and scale it down."""
    if value > 1:
        value = value / 100
    return max(0.0, min(1.0, value))


def progress_dict(record: KoSyncProgress, document: str | None = None) -> dict:
    return {
        "document": document or record.document,
        "progress": record.progress,
        "percentage": record.percentage,
        "device": record.device,
        "device_id": record.device_id,
        "timestamp": record.timestamp,
    }


async def _mirror_to_reading_progress(
    session: AsyncSession, book_id: str, device: str, percentage: float, position: str
) -> None:
    """Keep the book page's per-device progress in step with synced positions."""
    record = await session.scalar(
        select(ReadingProgress).where(
            ReadingProgress.book_id == book_id, ReadingProgress.device == device
        )
    )
    if record is None:
        record = ReadingProgress(book_id=book_id, device=device)
        session.add(record)
    record.progress = round(percentage * 100, 2)
    record.position = position
    record.updated_at = datetime.now(UTC).replace(tzinfo=None)


async def save_progress(
    session: AsyncSession,
    *,
    username: str,
    document: str,
    progress: str,
    percentage: float,
    device: str,
    device_id: str | None,
    book_id: str | None = None,
    locator: str | None = None,
) -> KoSyncProgress:
    """Store a device's latest position for a document (one row per device)."""
    percentage = _normalise_percentage(percentage)
    if book_id is None:
        book_id = await resolve_book_id(session, document)

    key = KoSyncProgress.device_id == device_id if device_id else KoSyncProgress.device == device
    record = await session.scalar(
        select(KoSyncProgress).where(
            KoSyncProgress.username == username, KoSyncProgress.document == document, key
        )
    )
    if record is None:
        record = KoSyncProgress(username=username, document=document)
        session.add(record)
    record.progress = progress
    record.percentage = percentage
    record.device = device
    record.device_id = device_id
    record.book_id = book_id
    record.locator = locator
    record.timestamp = _now_ts()

    if book_id is not None:
        await _mirror_to_reading_progress(session, book_id, device, percentage, progress)
    await session.commit()
    return record


async def push_progress(
    session: AsyncSession,
    username: str,
    document: str,
    progress: str,
    percentage: float,
    device: str,
    device_id: str | None = None,
) -> dict:
    """Store progress sent by KOReader."""
    record = await save_progress(
        session,
        username=username,
        document=document,
        progress=progress,
        percentage=percentage,
        device=device,
        device_id=device_id,
    )
    return progress_dict(record)


async def latest_progress_for_book(
    session: AsyncSession, book_id: str, username: str | None = None
) -> KoSyncProgress | None:
    """The most recent position for a book, across all its digests.

    With ``username``, only that account's positions and the web reader's count;
    without, every account's (the web reader acts for the library owner).
    """
    query = select(KoSyncProgress).where(KoSyncProgress.book_id == book_id)
    if username is not None:
        query = query.where(
            or_(
                KoSyncProgress.username == username,
                KoSyncProgress.username == WEB_READER_USERNAME,
            )
        )
    return await session.scalar(
        query.order_by(KoSyncProgress.timestamp.desc(), KoSyncProgress.id.desc()).limit(1)
    )


async def pull_progress(session: AsyncSession, username: str, document: str) -> dict | None:
    """The latest position for a document, as KOReader asks for it.

    The newest record wins (not the furthest), so going back to re-read a
    chapter on one device carries over. If the digest belongs to a library book,
    positions saved under the book's other digests and by the web reader count.
    """
    book_id = await resolve_book_id(session, document)
    if book_id is not None:
        record = await latest_progress_for_book(session, book_id, username)
    else:
        record = await session.scalar(
            select(KoSyncProgress)
            .where(KoSyncProgress.username == username, KoSyncProgress.document == document)
            .order_by(KoSyncProgress.timestamp.desc(), KoSyncProgress.id.desc())
            .limit(1)
        )
    if record is None:
        return None
    return progress_dict(record, document)


async def save_web_progress(
    session: AsyncSession,
    book: Book,
    *,
    progress: str,
    percentage: float,
    locator: str | None,
) -> KoSyncProgress:
    """Store the web reader's position so KOReader picks it up on its next sync."""
    return await save_progress(
        session,
        username=WEB_READER_USERNAME,
        document=book.file_hash_md5_ko or f"book:{book.id}",
        progress=progress,
        percentage=percentage,
        device=WEB_READER_DEVICE,
        device_id=WEB_READER_DEVICE_ID,
        book_id=book.id,
        locator=locator,
    )


# ── carrying a position across a rebuilt file ─────────────────────────────────

REBUILD_DEVICE = "Shelfloom"
REBUILD_DEVICE_ID = "shelfloom-rebuild"

_DOC_FRAGMENT = re.compile(r"^/body(?:\[1\])?/DocFragment\[(\d+)\]")


def epub_spine(path: str | PurePath) -> list[tuple[str, int]]:
    """Spine of an EPUB as (href, uncompressed size) pairs, in reading order.

    KOReader numbers these DocFragment[1], DocFragment[2], … (every spine item
    gets one), so this is what an XPointer's first step refers to.
    """
    import posixpath
    import zipfile
    from xml.etree import ElementTree

    with zipfile.ZipFile(path) as z:
        container = ElementTree.fromstring(z.read("META-INF/container.xml"))
        rootfile = next(el for el in container.iter() if el.tag.endswith("rootfile"))
        opf_path = rootfile.attrib["full-path"]
        opf = ElementTree.fromstring(z.read(opf_path))
        base = posixpath.dirname(opf_path)
        hrefs = {
            el.attrib["id"]: el.attrib["href"]
            for el in opf.iter()
            if el.tag.endswith("item") and "id" in el.attrib and "href" in el.attrib
        }
        sizes = {info.filename: info.file_size for info in z.infolist()}
        spine = []
        for el in opf.iter():
            if el.tag.endswith("itemref"):
                href = hrefs.get(el.attrib.get("idref", ""), "")
                full = posixpath.normpath(posixpath.join(base, href)) if base else href
                spine.append((href, sizes.get(full, 0)))
        return spine


def _chapter_number(href: str) -> int | None:
    m = re.search(r"chapter_(\d+)\.xhtml$", href)
    return int(m.group(1)) if m else None


def remap_position(
    progress: str,
    percentage: float,
    old_spine: list[tuple[str, int]],
    new_spine: list[tuple[str, int]],
) -> tuple[str, float] | None:
    """Move a KOReader position from an old build of a book to a new one.

    The spine item it was in is found in the new spine by href (for serial
    volumes, one file per chapter), so the rest of the XPointer (the path
    inside that chapter) still applies. If the chapter is no longer in the
    book, the position moves to the start of the next chapter that is.
    The percentage is re-estimated from spine item sizes. Returns None if the
    position doesn't need to change or can't be mapped.
    """
    m = _DOC_FRAGMENT.match(progress)
    if not m or not old_spine or not new_spine:
        return None
    old_index = int(m.group(1)) - 1
    if not 0 <= old_index < len(old_spine):
        return None
    href = old_spine[old_index][0]
    new_hrefs = [h for h, _ in new_spine]
    rest = progress[m.end() :]
    if href in new_hrefs:
        new_index = new_hrefs.index(href)
    else:
        number = _chapter_number(href)
        later = [
            i
            for i, h in enumerate(new_hrefs)
            if number is not None and (_chapter_number(h) or -1) > number
        ]
        new_index = later[0] if later else len(new_hrefs) - 1
        rest = "/body"  # start of that chapter
    new_progress = f"/body/DocFragment[{new_index + 1}]{rest}"

    # How far into its spine item the position was, from the old percentage.
    old_total = sum(s for _, s in old_spine) or 1
    old_before = sum(s for _, s in old_spine[:old_index])
    old_size = old_spine[old_index][1] or 1
    within = (percentage * old_total - old_before) / old_size
    within = max(0.0, min(1.0, within)) if href in new_hrefs else 0.0
    new_total = sum(s for _, s in new_spine) or 1
    new_before = sum(s for _, s in new_spine[:new_index])
    new_pct = (new_before + within * new_spine[new_index][1]) / new_total

    if new_progress == progress and abs(new_pct - percentage) < 0.001:
        return None
    return new_progress, max(0.0, min(1.0, new_pct))


async def carry_position_across_rebuild(
    session: AsyncSession,
    book: Book,
    old_spine: list[tuple[str, int]],
    new_spine: list[tuple[str, int]],
) -> KoSyncProgress | None:
    """After a book's file is rebuilt, re-save its latest position for the new layout.

    It is saved as a new record from "Shelfloom", newer than the device's own:
    KOReader ignores a record from its own device (and would otherwise keep its
    now-shifted local position), but follows a newer one from elsewhere.
    """
    if old_spine == new_spine:
        return None
    latest = await latest_progress_for_book(session, book.id)
    if latest is None:
        return None
    mapped = remap_position(latest.progress, latest.percentage, old_spine, new_spine)
    if mapped is None:
        return None
    progress, percentage = mapped
    log.info(
        "Moved %s position %s -> %s after rebuild of book %s",
        latest.device,
        latest.progress,
        progress,
        book.id,
    )
    return await save_progress(
        session,
        username=WEB_READER_USERNAME,
        document=book.file_hash_md5_ko or f"book:{book.id}",
        progress=progress,
        percentage=percentage,
        device=REBUILD_DEVICE,
        device_id=REBUILD_DEVICE_ID,
        book_id=book.id,
        locator=None,
    )
