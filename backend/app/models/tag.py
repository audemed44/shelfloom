from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    book_tags: Mapped[list["BookTag"]] = relationship(
        "BookTag", back_populates="tag", cascade="all, delete-orphan"
    )


class BookTag(Base):
    __tablename__ = "book_tags"

    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )

    book: Mapped["Book"] = relationship("Book", back_populates="tags")  # type: ignore[name-defined]  # noqa: F821
    tag: Mapped["Tag"] = relationship("Tag", back_populates="book_tags")
