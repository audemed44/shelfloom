import os

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.shelf import Shelf
from app.schemas.shelf import ShelfCreate, ShelfUpdate


class ShelfError(Exception):
    pass


class ShelfNotFound(ShelfError):
    pass


class ShelfConflict(ShelfError):
    pass


class ShelfHasBooks(ShelfError):
    pass


class PathNotFound(ShelfError):
    pass


async def list_shelves(session: AsyncSession) -> list[tuple[Shelf, int]]:
    result = await session.execute(
        select(Shelf, func.count(Book.id).label("book_count"))
        .outerjoin(Book, Book.shelf_id == Shelf.id)
        .group_by(Shelf.id)
        .order_by(Shelf.id)
    )
    return result.all()  # type: ignore[return-value]


async def get_shelf(session: AsyncSession, shelf_id: int) -> tuple[Shelf, int]:
    result = await session.execute(
        select(Shelf, func.count(Book.id).label("book_count"))
        .outerjoin(Book, Book.shelf_id == Shelf.id)
        .where(Shelf.id == shelf_id)
        .group_by(Shelf.id)
    )
    row = result.first()
    if row is None:
        raise ShelfNotFound(f"Shelf {shelf_id} not found")
    return row  # type: ignore[return-value]


async def create_shelf(
    session: AsyncSession, data: ShelfCreate, require_path_exists: bool = True
) -> Shelf:
    if require_path_exists and not os.path.isdir(data.path):
        raise PathNotFound(f"Directory does not exist: {data.path}")

    if data.is_default:
        await _clear_default(session)

    shelf = Shelf(
        name=data.name,
        path=data.path,
        is_default=data.is_default,
        is_sync_target=data.is_sync_target,
        device_name=data.device_name,
        auto_organize=data.auto_organize,
    )
    session.add(shelf)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ShelfConflict(f"A shelf named '{data.name}' already exists")
    await session.refresh(shelf)
    return shelf


async def update_shelf(
    session: AsyncSession, shelf_id: int, data: ShelfUpdate
) -> Shelf:
    shelf_row = await get_shelf(session, shelf_id)
    shelf = shelf_row[0]

    if data.name is not None:
        shelf.name = data.name.strip()
    if data.is_default is not None:
        if data.is_default:
            await _clear_default(session)
        shelf.is_default = data.is_default
    if data.is_sync_target is not None:
        shelf.is_sync_target = data.is_sync_target
    if data.device_name is not None:
        shelf.device_name = data.device_name
    if data.auto_organize is not None:
        shelf.auto_organize = data.auto_organize

    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ShelfConflict(f"A shelf named '{data.name}' already exists")
    await session.refresh(shelf)
    return shelf


async def delete_shelf(session: AsyncSession, shelf_id: int) -> None:
    shelf_row = await get_shelf(session, shelf_id)
    shelf, book_count = shelf_row

    if book_count > 0:
        raise ShelfHasBooks(
            f"Cannot delete shelf '{shelf.name}': it contains {book_count} book(s)"
        )
    await session.delete(shelf)
    await session.commit()


async def ensure_default_shelf(  # pragma: no cover
    session: AsyncSession, name: str, path: str
) -> Shelf | None:
    """Create the default shelf from config if none exist."""
    result = await session.execute(select(func.count()).select_from(Shelf))
    count = result.scalar_one()
    if count > 0:
        return None
    data = ShelfCreate(name=name, path=path, is_default=True)
    return await create_shelf(session, data, require_path_exists=False)


async def _clear_default(session: AsyncSession) -> None:
    result = await session.execute(select(Shelf).where(Shelf.is_default == True))  # noqa: E712
    for shelf in result.scalars().all():
        shelf.is_default = False
