from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Shelf(Base):
    __tablename__ = "shelves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_sync_target: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    device_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    koreader_stats_db_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_organize: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    books: Mapped[list["Book"]] = relationship("Book", back_populates="shelf")  # type: ignore[name-defined]  # noqa: F821
    template: Mapped["ShelfTemplate | None"] = relationship(
        "ShelfTemplate",
        back_populates="shelf",
        uselist=False,
        cascade="all, delete-orphan",
    )


class ShelfTemplate(Base):
    __tablename__ = "shelf_templates"

    shelf_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shelves.id", ondelete="CASCADE"), primary_key=True
    )
    template: Mapped[str] = mapped_column(Text, nullable=False)
    seq_pad: Mapped[int] = mapped_column(Integer, default=2, nullable=False)

    shelf: Mapped["Shelf"] = relationship("Shelf", back_populates="template")
