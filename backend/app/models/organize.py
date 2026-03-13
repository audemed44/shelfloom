from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RenameLog(Base):
    __tablename__ = "rename_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("books.id", ondelete="SET NULL"), nullable=True
    )
    shelf_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shelves.id", ondelete="SET NULL"), nullable=True
    )
    template: Mapped[str] = mapped_column(Text, nullable=False)
    old_path: Mapped[str] = mapped_column(Text, nullable=False)
    new_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
