"""Schemas for reading data API."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class HighlightOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    book_id: str
    text: str
    note: str | None
    chapter: str | None
    page: int | None
    created: datetime | None


class ReadingSessionOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    book_id: str
    start_time: datetime | None
    duration: int | None
    pages_read: int | None
    device: str | None
    source: str
    dismissed: bool


class ReadingProgressOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    book_id: str
    progress: float | None
    device: str | None
    chapter: str | None
    position: str | None
    updated_at: datetime


class BookReadingSummary(BaseModel):
    total_sessions: int
    total_time_seconds: int
    percent_finished: float | None
