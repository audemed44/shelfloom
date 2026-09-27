"""KOSync user and progress models."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KoSyncUser(Base):
    __tablename__ = "kosync_users"

    username: Mapped[str] = mapped_column(Text, primary_key=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)


# Positions saved by Shelfloom's own web reader are stored under this username,
# so every KOReader account sees them.
WEB_READER_USERNAME = ""
WEB_READER_DEVICE = "Shelfloom Web"
WEB_READER_DEVICE_ID = "shelfloom-web"


class KoSyncProgress(Base):
    """A reading position reported by one device (or the web reader).

    ``document`` is the digest KOReader identifies the file by (a partial MD5 of
    the file, or an MD5 of its filename). ``book_id`` is the library book that
    digest was matched to, if any, so positions follow a book across file
    changes. ``percentage`` is 0–1, as KOReader sends it.
    """

    __tablename__ = "kosync_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    document: Mapped[str] = mapped_column(Text, nullable=False)
    progress: Mapped[str] = mapped_column(Text, nullable=False, default="")
    percentage: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    device: Mapped[str] = mapped_column(Text, nullable=False, default="")
    device_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    book_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Web reader only: its own precise locator (an EPUB CFI) for exact resume.
    locator: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
