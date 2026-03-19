from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WebSerial(Base):
    __tablename__ = "web_serials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    source: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # "royalroad" | "novelfire" | "wanderinginn"
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Text, default="ongoing", nullable=False
    )  # ongoing|completed|paused|error
    total_chapters: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    series_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("series.id", ondelete="SET NULL"), nullable=True
    )

    chapters: Mapped[list["SerialChapter"]] = relationship(
        "SerialChapter", back_populates="serial", cascade="all, delete-orphan"
    )
    volumes: Mapped[list["SerialVolume"]] = relationship(
        "SerialVolume", back_populates="serial", cascade="all, delete-orphan"
    )
    series: Mapped["Series | None"] = relationship("Series")  # type: ignore[name-defined]  # noqa: F821


class SerialChapter(Base):
    __tablename__ = "serial_chapters"
    __table_args__ = (
        Index(
            "ix_serial_chapters_serial_id_chapter_number",
            "serial_id",
            "chapter_number",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("web_serials.id", ondelete="CASCADE"), nullable=False
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-based
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    publish_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    content: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # cleaned HTML, null until fetched
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    serial: Mapped["WebSerial"] = relationship("WebSerial", back_populates="chapters")


class SerialVolume(Base):
    __tablename__ = "serial_volumes"
    __table_args__ = (
        Index(
            "ix_serial_volumes_serial_id_volume_number", "serial_id", "volume_number", unique=True
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("web_serials.id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("books.id", ondelete="SET NULL"), nullable=True
    )
    volume_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # custom name; falls back to "{title} - Volume {N}"
    cover_path: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # custom cover; falls back to serial cover
    chapter_start: Mapped[int] = mapped_column(Integer, nullable=False)
    chapter_end: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_stale: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    serial: Mapped["WebSerial"] = relationship("WebSerial", back_populates="volumes")
    book: Mapped["Book | None"] = relationship("Book")  # type: ignore[name-defined]  # noqa: F821
