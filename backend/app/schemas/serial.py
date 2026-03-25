from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SerialCreate(BaseModel):
    url: str
    shelf_id: int | None = None
    adapter: str | None = None


class SerialUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    description: str | None = None
    status: str | None = None


class SerialResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    url: str
    source: str
    title: str | None
    author: str | None
    description: str | None
    cover_path: str | None
    cover_url: str | None
    status: str
    total_chapters: int
    last_checked_at: datetime | None
    last_error: str | None
    created_at: datetime
    series_id: int | None


class ChapterResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    serial_id: int
    chapter_number: int
    title: str | None
    source_url: str
    publish_date: datetime | None
    word_count: int | None
    estimated_pages: int | None = None
    running_word_count: int = 0
    running_estimated_pages: int | None = None
    running_is_partial: bool = False
    fetched_at: datetime | None
    has_content: bool = False

    @classmethod
    def from_orm(
        cls,
        obj: object,
        *,
        estimated_pages: int | None = None,
        running_word_count: int = 0,
        running_estimated_pages: int | None = None,
        running_is_partial: bool = False,
    ) -> ChapterResponse:
        from app.models.serial import SerialChapter

        assert isinstance(obj, SerialChapter)
        return cls(
            id=obj.id,
            serial_id=obj.serial_id,
            chapter_number=obj.chapter_number,
            title=obj.title,
            source_url=obj.source_url,
            publish_date=obj.publish_date,
            word_count=obj.word_count,
            estimated_pages=estimated_pages,
            running_word_count=running_word_count,
            running_estimated_pages=running_estimated_pages,
            running_is_partial=running_is_partial,
            fetched_at=obj.fetched_at,
            has_content=obj.content is not None,
        )


class ChapterFetchRequest(BaseModel):
    start: int
    end: int


class ChapterFetchLogEntry(BaseModel):
    timestamp: datetime
    level: str
    message: str
    chapter_number: int | None = None


class ChapterFetchJobResponse(BaseModel):
    serial_id: int
    state: str
    start: int
    end: int
    total: int
    started_at: datetime


class ChapterFetchStatusResponse(BaseModel):
    serial_id: int
    state: str
    start: int | None = None
    end: int | None = None
    total: int = 0
    processed: int = 0
    fetched: int = 0
    skipped: int = 0
    failed: int = 0
    current_chapter_number: int | None = None
    current_chapter_title: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    logs: list[ChapterFetchLogEntry] = Field(default_factory=list)
    error: str | None = None


class VolumeRange(BaseModel):
    start: int
    end: int
    name: str | None = None


class VolumeConfigCreate(BaseModel):
    splits: list[VolumeRange]


class AutoSplitConfig(BaseModel):
    chapters_per_volume: int


class VolumeUpdate(BaseModel):
    name: str | None = None


class SingleVolumeCreate(BaseModel):
    start: int
    end: int
    name: str | None = None


class VolumeResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    serial_id: int
    book_id: str | None
    volume_number: int
    name: str | None
    cover_path: str | None
    chapter_start: int
    chapter_end: int
    generated_at: datetime | None
    is_stale: bool
    estimated_pages: int | None = None
    total_words: int | None = None


class VolumePreviewResponse(BaseModel):
    start: int
    end: int
    name: str | None = None
    chapter_count: int
    fetched_chapter_count: int
    total_words: int = 0
    estimated_pages: int | None = None
    is_partial: bool = False
