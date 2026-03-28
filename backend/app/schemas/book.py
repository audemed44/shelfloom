from datetime import datetime

from pydantic import BaseModel, field_validator


class TagOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str


class GenreOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str


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
    rating: float | None = None
    has_review: bool = False
    status: str
    date_added: datetime
    date_published: str | None
    genres: list[GenreOut] = []
    reading_progress: float | None = None  # 0–100, max across all devices
    last_read: datetime | None = None
    series_id: int | None = None
    series_name: str | None = None
    series_sequence: float | None = None
    tags: list[TagOut] = []


class BookDetailResponse(BookResponse):
    review: str | None = None
    review_updated_at: datetime | None = None


class BookUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    isbn: str | None = None
    publisher: str | None = None
    language: str | None = None
    description: str | None = None
    date_published: str | None = None
    rating: float | None = None
    review: str | None = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if value < 0.5 or value > 5:
            raise ValueError("Rating must be between 0.5 and 5.0")
        doubled = value * 2
        if abs(doubled - round(doubled)) > 1e-9:
            raise ValueError("Rating must be in 0.5 increments")
        return float(value)


class BookListResponse(BaseModel):
    model_config = {"from_attributes": True}

    items: list[BookResponse]
    total: int
    page: int
    per_page: int
    pages: int


class ManualBookCreate(BaseModel):
    title: str
    author: str | None = None
    isbn: str | None = None
    format: str = "physical"  # "physical" or "visual_novel"
    publisher: str | None = None
    language: str | None = None
    description: str | None = None
    page_count: int | None = None
    date_published: str | None = None


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


# ---------------------------------------------------------------------------
# Bulk action schemas
# ---------------------------------------------------------------------------


class BulkBookMetadataUpdate(BaseModel):
    book_ids: list[str]
    add_tag_ids: list[int] = []
    remove_tag_ids: list[int] = []
    add_genre_ids: list[int] = []
    remove_genre_ids: list[int] = []


class BulkBookMoveRequest(BaseModel):
    book_ids: list[str]
    target_shelf_id: int


class BulkBookActionResult(BaseModel):
    book_id: str
    success: bool
    error: str | None = None


class BulkBookActionResponse(BaseModel):
    results: list[BulkBookActionResult]
    total: int
    succeeded: int
    failed: int
