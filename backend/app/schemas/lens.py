from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LensFilterState(BaseModel):
    genres: list[int] = []
    tags: list[int] = []
    series_ids: list[int] = []
    authors: list[str] = []
    formats: list[str] = []
    mode: Literal["and", "or"] = "and"
    shelf_id: int | None = None
    status: str | None = None


class LensCreate(BaseModel):
    name: str
    filter_state: LensFilterState


class LensUpdate(BaseModel):
    name: str | None = None
    filter_state: LensFilterState | None = None


class LensResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    filter_state: LensFilterState
    book_count: int = 0
    cover_book_id: str | None = None
    created_at: datetime
    updated_at: datetime
