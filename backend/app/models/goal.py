"""Yearly reading goals."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReadingGoal(Base):
    """How many books to finish in a calendar year."""

    __tablename__ = "reading_goals"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    books: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
