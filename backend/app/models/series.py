from sqlalchemy import Float, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("series.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    parent: Mapped["Series | None"] = relationship(
        "Series", remote_side="Series.id", back_populates="children"
    )
    children: Mapped[list["Series"]] = relationship("Series", back_populates="parent")
    book_entries: Mapped[list["BookSeries"]] = relationship(
        "BookSeries", back_populates="series", cascade="all, delete-orphan"
    )
    reading_orders: Mapped[list["ReadingOrder"]] = relationship(
        "ReadingOrder", back_populates="series", cascade="all, delete-orphan"
    )


class BookSeries(Base):
    __tablename__ = "book_series"

    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    series_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    sequence: Mapped[float | None] = mapped_column(Float, nullable=True)

    book: Mapped["Book"] = relationship("Book", back_populates="series_entries")  # type: ignore[name-defined]  # noqa: F821
    series: Mapped["Series"] = relationship("Series", back_populates="book_entries")


class ReadingOrder(Base):
    __tablename__ = "reading_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    series_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )

    series: Mapped["Series"] = relationship("Series", back_populates="reading_orders")
    entries: Mapped[list["ReadingOrderEntry"]] = relationship(
        "ReadingOrderEntry",
        back_populates="reading_order",
        cascade="all, delete-orphan",
        order_by="ReadingOrderEntry.position",
    )


class ReadingOrderEntry(Base):
    __tablename__ = "reading_order_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reading_order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reading_orders.id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[str] = mapped_column(
        Text, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    reading_order: Mapped["ReadingOrder"] = relationship("ReadingOrder", back_populates="entries")
    book: Mapped["Book"] = relationship("Book", back_populates="reading_order_entries")  # type: ignore[name-defined]  # noqa: F821
