"""Schemas for reading data API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


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


class ManualSessionCreate(BaseModel):
    start_time: datetime
    duration: int | None = None  # seconds
    pages_read: int | None = None


class BookReadingSummary(BaseModel):
    total_sessions: int
    total_time_seconds: int
    percent_finished: float | None


class BookPositionIn(BaseModel):
    """A position saved by the web reader."""

    progress: str  # KOReader XPointer, e.g. /body/DocFragment[12]/body/p[5]/text().42
    percentage: float = Field(ge=0, le=1)
    locator: str | None = None  # the web reader's own locator (EPUB CFI)


class BookPositionOut(BaseModel):
    """The latest synced position for a book, from KOReader or the web reader."""

    progress: str
    percentage: float  # 0–1
    device: str
    device_id: str | None
    timestamp: int
    locator: str | None  # only set when the web reader saved this position
    from_web_reader: bool


class WebSessionIn(BaseModel):
    """A web reading session; re-sent while reading to extend it."""

    start_time: datetime
    duration: int = Field(ge=0)  # seconds
    pages_read: int | None = Field(default=None, ge=0)
