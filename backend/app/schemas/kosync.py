"""Schemas for KOSync protocol."""

from __future__ import annotations

from pydantic import BaseModel, Field


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


class SyncAccountOut(BaseModel):
    username: str
    last_synced_at: int | None = None  # unix seconds
    last_device: str | None = None
    last_book_title: str | None = None


class SyncAccountCreate(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1)
