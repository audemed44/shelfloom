from datetime import datetime

from pydantic import BaseModel, field_validator


class ShelfCreate(BaseModel):
    name: str
    path: str
    is_default: bool = False
    is_sync_target: bool = False
    device_name: str | None = None
    auto_organize: bool = False
    organize_template: str | None = None
    seq_pad: int = 2

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("path")
    @classmethod
    def path_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("path must not be empty")
        return v.strip()


class ShelfUpdate(BaseModel):
    name: str | None = None
    is_default: bool | None = None
    is_sync_target: bool | None = None
    device_name: str | None = None
    auto_organize: bool | None = None
    organize_template: str | None = None
    seq_pad: int | None = None


class ShelfResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    path: str
    is_default: bool
    is_sync_target: bool
    device_name: str | None
    auto_organize: bool
    created_at: datetime
    book_count: int = 0
    organize_template: str | None = None
    seq_pad: int = 2
