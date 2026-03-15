"""Schemas for data management API (step 4.5)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SessionOut(BaseModel):
    id: int
    book_id: str
    start_time: datetime | None
    duration: int | None
    pages_read: int | None
    source: str
    dismissed: bool


class DuplicateSessionPair(BaseModel):
    dismissed: SessionOut
    active: SessionOut | None


class DuplicateSessionGroup(BaseModel):
    book_id: str
    book_title: str
    book_author: str | None
    pairs: list[DuplicateSessionPair]


class UnmatchedEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    title: str
    author: str | None
    source: str
    source_path: str | None
    session_count: int
    total_duration_seconds: int
    dismissed: bool
    linked_book_id: str | None
    created_at: datetime


class BookSummary(BaseModel):
    id: str
    title: str
    author: str | None
    format: str
    shelf_id: int
    date_added: str
    session_count: int


class DuplicateBookGroup(BaseModel):
    books: list[BookSummary]


class ImportLogEntry(BaseModel):
    id: int
    book_id: str
    book_title: str
    book_author: str | None
    hash_sha: str
    hash_md5: str
    page_count: int | None
    recorded_at: str


class ImportLogResponse(BaseModel):
    items: list[ImportLogEntry]
    total: int
    limit: int
    offset: int


class SessionLogEntry(BaseModel):
    id: int
    book_id: str
    book_title: str
    book_author: str | None
    source: str
    start_time: str | None
    duration: int | None
    pages_read: int | None
    device: str | None
    dismissed: bool
    created_at: str | None


class SessionLogResponse(BaseModel):
    items: list[SessionLogEntry]
    total: int
    limit: int
    offset: int


class MergeBooksRequest(BaseModel):
    keep_id: str
    discard_id: str


class LinkUnmatchedRequest(BaseModel):
    book_id: str


class BulkResolveResponse(BaseModel):
    dismissed: int


class SetDismissedRequest(BaseModel):
    dismissed: bool
