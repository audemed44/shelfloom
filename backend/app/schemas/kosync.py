"""Schemas for KOSync protocol."""

from __future__ import annotations

from pydantic import BaseModel


class KoSyncUserCreate(BaseModel):
    username: str
    password: str


class KoSyncProgressIn(BaseModel):
    document: str  # document identifier (KOReader uses partial MD5 or filename)
    progress: str  # KOReader XPointer (reflowable) or page number (PDF)
    percentage: float  # 0–1, as KOReader sends it (0–100 is scaled down)
    device: str
    device_id: str | None = None
    metadata: dict | None = None  # sent by newer KOReader versions; unused


class KoSyncProgressOut(BaseModel):
    document: str
    progress: str
    percentage: float
    device: str
    device_id: str | None = None
    timestamp: int
