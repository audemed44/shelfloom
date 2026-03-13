"""KOSync protocol service."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kosync import KoSyncUser, KoSyncProgress

log = logging.getLogger(__name__)


def _hash_password(password: str) -> str:
    """Simple SHA-256 password hash (sufficient for KOSync's local-only auth)."""
    return hashlib.sha256(password.encode()).hexdigest()


async def register_user(
    session: AsyncSession,
    username: str,
    password: str,
) -> KoSyncUser | None:
    """
    Register a new KOSync user.
    Returns None if username already exists.
    """
    existing = await session.execute(
        select(KoSyncUser).where(KoSyncUser.username == username)
    )
    if existing.scalar_one_or_none() is not None:
        return None

    user = KoSyncUser(username=username, password_hash=_hash_password(password))
    session.add(user)
    await session.commit()
    return user


async def authenticate_user(
    session: AsyncSession,
    username: str,
    password: str,
) -> KoSyncUser | None:
    """
    Authenticate a KOSync user.
    Returns user if credentials are correct, None otherwise.
    """
    result = await session.execute(
        select(KoSyncUser).where(KoSyncUser.username == username)
    )
    user = result.scalar_one_or_none()
    if user is None:
        return None
    if user.password_hash != _hash_password(password):
        return None
    return user


async def push_progress(
    session: AsyncSession,
    username: str,
    document: str,
    progress: str,
    percentage: float,
    device: str,
) -> dict:
    """
    Store or update reading progress from KOReader.
    Returns the stored progress data.
    """
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())

    # Upsert KoSyncProgress for this user/document/device
    result = await session.execute(
        select(KoSyncProgress).where(
            KoSyncProgress.username == username,
            KoSyncProgress.document == document,
            KoSyncProgress.device == device,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        record = KoSyncProgress(
            username=username,
            document=document,
            device=device,
        )
        session.add(record)

    record.progress = progress
    record.percentage = percentage
    record.timestamp = now_ts

    await session.commit()

    return {
        "document": document,
        "progress": progress,
        "percentage": percentage,
        "device": device,
        "timestamp": now_ts,
    }


async def pull_progress(
    session: AsyncSession,
    username: str,
    document: str,
) -> dict | None:
    """
    Pull the latest reading progress for a document (highest percentage across devices).
    Returns None if no progress found.
    """
    result = await session.execute(
        select(KoSyncProgress).where(
            KoSyncProgress.username == username,
            KoSyncProgress.document == document,
        ).order_by(KoSyncProgress.percentage.desc())
    )
    record = result.scalars().first()

    if record is None:
        return None

    return {
        "document": document,
        "progress": record.progress,
        "percentage": record.percentage,
        "device": record.device,
        "timestamp": record.timestamp,
    }
