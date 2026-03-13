"""KOSync user and progress models."""
from __future__ import annotations

from sqlalchemy import Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KoSyncUser(Base):
    __tablename__ = "kosync_users"

    username: Mapped[str] = mapped_column(Text, primary_key=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)


class KoSyncProgress(Base):
    __tablename__ = "kosync_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    document: Mapped[str] = mapped_column(Text, nullable=False)
    progress: Mapped[str] = mapped_column(Text, nullable=False, default="")
    percentage: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    device: Mapped[str] = mapped_column(Text, nullable=False, default="")
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
