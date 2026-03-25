from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Genre(Base):
    __tablename__ = "genres"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    book_genres: Mapped[list["BookGenre"]] = relationship(
        "BookGenre", back_populates="genre", cascade="all, delete-orphan"
    )


class BookGenre(Base):
    __tablename__ = "book_genres"

    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    genre_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True
    )

    book: Mapped["Book"] = relationship("Book", back_populates="genres")  # type: ignore[name-defined]  # noqa: F821
    genre: Mapped["Genre"] = relationship("Genre", back_populates="book_genres")
