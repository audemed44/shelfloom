from datetime import datetime

from pydantic import BaseModel


class BookResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    author: str | None
    isbn: str | None
    format: str
    file_path: str
    shelf_id: int
    file_hash: str | None
    file_size: int | None
    cover_path: str | None
    publisher: str | None
    language: str | None
    description: str | None
    page_count: int | None
    date_added: datetime
    date_published: str | None
    genre: str | None
    reading_progress: float | None = None  # 0–100, max across all devices
    last_read: datetime | None = None
    series_id: int | None = None
    series_name: str | None = None
    series_sequence: float | None = None


class BookUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    isbn: str | None = None
    publisher: str | None = None
    language: str | None = None
    description: str | None = None
    date_published: str | None = None
    genre: str | None = None


class BookListResponse(BaseModel):
    model_config = {"from_attributes": True}

    items: list[BookResponse]
    total: int
    page: int
    per_page: int
    pages: int


class BookMoveRequest(BaseModel):
    shelf_id: int


class BookSeriesNeighbour(BaseModel):
    id: str
    title: str
    sequence: float | None


class BookSeriesMembership(BaseModel):
    series_id: int
    series_name: str
    sequence: float | None
    prev_book: BookSeriesNeighbour | None
    next_book: BookSeriesNeighbour | None
