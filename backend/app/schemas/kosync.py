"""Schemas for KOSync protocol."""

from __future__ import annotations

from pydantic import BaseModel


class KoSyncUserCreate(BaseModel):
    username: str
    password: str


class KoSyncProgressIn(BaseModel):
    document: str  # document identifier (KOReader uses partial MD5 or filename)
    progress: str  # e.g., "0.5" or XPointer string
    percentage: float  # 0.0–100.0 (KOSync uses 0–100 not 0–1)
    device: str
    device_id: str


class KoSyncProgressOut(BaseModel):
    document: str
    progress: str
    percentage: float
    device: str
    timestamp: int
