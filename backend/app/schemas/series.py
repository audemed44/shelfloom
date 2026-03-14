from pydantic import BaseModel


class SeriesCreate(BaseModel):
    name: str
    parent_id: int | None = None
    description: str | None = None
    sort_order: int = 0


class SeriesUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    description: str | None = None
    sort_order: int | None = None


class SeriesResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    name: str
    parent_id: int | None
    description: str | None
    sort_order: int
    cover_path: str | None = None


class SeriesTreeNode(SeriesResponse):
    children: list["SeriesTreeNode"] = []
    book_count: int = 0


class BookSeriesEntry(BaseModel):
    series_id: int
    sequence: float | None = None


class ReadingOrderCreate(BaseModel):
    name: str
    series_id: int


class ReadingOrderResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    name: str
    series_id: int


class ReadingOrderEntryCreate(BaseModel):
    book_id: str
    position: int
    note: str | None = None


class ReadingOrderEntryResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    reading_order_id: int
    book_id: str
    position: int
    note: str | None


class ReadingOrderDetailResponse(ReadingOrderResponse):
    entries: list[ReadingOrderEntryResponse] = []


class SeriesBookItem(BaseModel):
    book_id: str
    sequence: float | None = None
    title: str
    author: str | None = None
    format: str | None = None
    cover_path: str | None = None
