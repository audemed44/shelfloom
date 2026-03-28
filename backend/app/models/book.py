from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Book(Base):
    __tablename__ = "books"
    __table_args__ = (Index("ix_books_shelf_id_file_path", "shelf_id", "file_path", unique=True),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # UUID
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str | None] = mapped_column(Text, nullable=True)
    isbn: Mapped[str | None] = mapped_column(Text, nullable=True)
    format: Mapped[str] = mapped_column(Text, nullable=False)  # "epub" or "pdf"
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    shelf_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shelves.id", ondelete="RESTRICT"), nullable=False
    )
    file_hash: Mapped[str | None] = mapped_column(Text, nullable=True)  # SHA-256
    file_hash_md5: Mapped[str | None] = mapped_column(Text, nullable=True)  # full MD5
    file_hash_md5_ko: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # KOReader partial MD5
    epub_uid: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    publisher: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    review: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reading_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_added: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    date_published: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_raw: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON

    shelf: Mapped["Shelf"] = relationship("Shelf", back_populates="books")  # type: ignore[name-defined]  # noqa: F821
    hashes: Mapped[list["BookHash"]] = relationship(
        "BookHash", back_populates="book", cascade="all, delete-orphan"
    )
    series_entries: Mapped[list["BookSeries"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BookSeries", back_populates="book", cascade="all, delete-orphan"
    )
    tags: Mapped[list["BookTag"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BookTag", back_populates="book", cascade="all, delete-orphan"
    )
    genres: Mapped[list["BookGenre"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BookGenre", back_populates="book", cascade="all, delete-orphan"
    )
    reading_progress: Mapped[list["ReadingProgress"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ReadingProgress", back_populates="book", cascade="all, delete-orphan"
    )
    reading_sessions: Mapped[list["ReadingSession"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ReadingSession", back_populates="book", cascade="all, delete-orphan"
    )
    highlights: Mapped[list["Highlight"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Highlight", back_populates="book", cascade="all, delete-orphan"
    )
    reading_order_entries: Mapped[list["ReadingOrderEntry"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ReadingOrderEntry", back_populates="book", cascade="all, delete-orphan"
    )


class BookHash(Base):
    __tablename__ = "book_hashes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    hash_sha: Mapped[str] = mapped_column(Text, nullable=False)
    hash_md5: Mapped[str] = mapped_column(Text, nullable=False)
    hash_md5_ko: Mapped[str | None] = mapped_column(Text, nullable=True)  # KOReader partial MD5
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    book: Mapped["Book"] = relationship("Book", back_populates="hashes")
