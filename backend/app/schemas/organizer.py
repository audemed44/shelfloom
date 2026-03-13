from datetime import datetime

from pydantic import BaseModel


class PreviewParams(BaseModel):
    shelf_id: int
    template: str | None = None
    seq_pad: int = 2


class ApplyRequest(BaseModel):
    shelf_id: int
    template: str | None = None
    seq_pad: int = 2


class OrganizerResultResponse(BaseModel):
    book_id: str
    book_title: str
    old_path: str
    new_path: str
    moved: bool
    already_correct: bool
    error: str | None


class RenameLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    book_id: str | None
    shelf_id: int | None
    template: str
    old_path: str
    new_path: str
    created_at: datetime
