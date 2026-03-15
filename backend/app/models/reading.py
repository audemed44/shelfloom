from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UnmatchedKOReaderEntry(Base):
    """KOReader book that could not be matched to a Shelfloom book during import."""

    __tablename__ = "unmatched_koreader_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)  # "stats_db" or "sdr"
    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    linked_book_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("books.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class UnmatchedSession(Base):
    """Raw session data preserved for an unmatched KOReader entry, transferred on link."""

    __tablename__ = "unmatched_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    unmatched_entry_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("unmatched_koreader_entries.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    pages_read: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_key: Mapped[str | None] = mapped_column(Text, nullable=True)


class ReadingProgress(Base):
    __tablename__ = "reading_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    progress: Mapped[float | None] = mapped_column(nullable=True)  # 0–100
    device: Mapped[str | None] = mapped_column(Text, nullable=True)
    chapter: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    book: Mapped["Book"] = relationship("Book", back_populates="reading_progress")  # type: ignore[name-defined]  # noqa: F821


class ReadingSession(Base):
    __tablename__ = "reading_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    pages_read: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)  # "stats_db", "sdr", "manual"
    source_key: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), nullable=True
    )

    book: Mapped["Book"] = relationship("Book", back_populates="reading_sessions")  # type: ignore[name-defined]  # noqa: F821


class Highlight(Base):
    __tablename__ = "highlights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    chapter: Mapped[str | None] = mapped_column(Text, nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    book: Mapped["Book"] = relationship("Book", back_populates="highlights")  # type: ignore[name-defined]  # noqa: F821
