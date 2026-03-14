from pydantic import BaseModel, model_validator


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


class AddBookToSeriesBody(BaseModel):
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


class ReadingOrderEntryWithBookResponse(BaseModel):
    """Entry response that includes the book's title, author, format, and cover."""

    id: int
    reading_order_id: int
    book_id: str
    position: int
    note: str | None = None
    title: str | None = None
    author: str | None = None
    format: str | None = None
    cover_path: str | None = None

    @model_validator(mode="before")
    @classmethod
    def extract_book(cls, v: object) -> object:
        book = getattr(v, "book", None)
        if book is not None:
            return {
                "id": v.id,  # type: ignore[union-attr]
                "reading_order_id": v.reading_order_id,  # type: ignore[union-attr]
                "book_id": v.book_id,  # type: ignore[union-attr]
                "position": v.position,  # type: ignore[union-attr]
                "note": v.note,  # type: ignore[union-attr]
                "title": book.title,
                "author": book.author,
                "format": book.format,
                "cover_path": book.cover_path,
            }
        return v


class ReadingOrderDetailResponse(ReadingOrderResponse):
    entries: list[ReadingOrderEntryWithBookResponse] = []


class SeriesBookItem(BaseModel):
    book_id: str
    sequence: float | None = None
    title: str
    author: str | None = None
    format: str | None = None
    cover_path: str | None = None
