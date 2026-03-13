from datetime import datetime

from pydantic import BaseModel


class ScanProgressResponse(BaseModel):
    total: int
    processed: int
    created: int
    updated: int
    skipped: int
    errors: list[str]


class ScanStatusResponse(BaseModel):
    is_running: bool
    last_scan_at: datetime | None
    progress: ScanProgressResponse | None
    error: str | None
