"""Lens (saved filter preset) CRUD service."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.lens import Lens
from app.schemas.lens import LensFilterState
from app.services.book_service import list_books


class LensNotFound(Exception):
    pass


def _fs_to_kwargs(fs: LensFilterState) -> dict:
    """Convert a LensFilterState into kwargs for list_books."""
    kwargs: dict = {}
    if fs.genres:
        kwargs["genre"] = ",".join(str(g) for g in fs.genres)
    if fs.tags:
        kwargs["tag"] = ",".join(str(t) for t in fs.tags)
    if fs.series_ids:
        kwargs["series_id"] = ",".join(str(s) for s in fs.series_ids)
    if fs.authors:
        kwargs["author"] = ",".join(fs.authors)
    if fs.formats:
        kwargs["format"] = ",".join(fs.formats)
    if fs.shelf_id is not None:
        kwargs["shelf_id"] = fs.shelf_id
    if fs.status is not None:
        kwargs["status"] = fs.status
    kwargs["filter_mode"] = fs.mode
    return kwargs


async def create_lens(
    session: AsyncSession,
    name: str,
    filter_state: LensFilterState,
) -> Lens:
    lens = Lens(
        name=name,
        filter_state=filter_state.model_dump_json(),
    )
    session.add(lens)
    await session.commit()
    await session.refresh(lens)
    return lens


async def list_lenses(session: AsyncSession) -> list[dict]:
    """Return all lenses with computed book_count and cover_book_id."""
    result = await session.execute(select(Lens).order_by(Lens.sort_order, Lens.created_at))
    lenses = result.scalars().all()

    out = []
    for lens in lenses:
        fs = LensFilterState.model_validate(json.loads(lens.filter_state))
        kwargs = _fs_to_kwargs(fs)
        books, total = await list_books(session, per_page=1, **kwargs)
        cover_book_id = books[0].id if books else None
        out.append(
            {
                "id": lens.id,
                "name": lens.name,
                "filter_state": fs,
                "book_count": total,
                "cover_book_id": cover_book_id,
                "created_at": lens.created_at,
                "updated_at": lens.updated_at,
            }
        )
    return out


async def get_lens(session: AsyncSession, lens_id: int) -> Lens:
    result = await session.execute(select(Lens).where(Lens.id == lens_id))
    lens = result.scalar_one_or_none()
    if lens is None:
        raise LensNotFound(f"Lens {lens_id} not found")
    return lens


async def update_lens(
    session: AsyncSession,
    lens_id: int,
    name: str | None = None,
    filter_state: LensFilterState | None = None,
) -> Lens:
    lens = await get_lens(session, lens_id)
    if name is not None:
        lens.name = name
    if filter_state is not None:
        lens.filter_state = filter_state.model_dump_json()
    await session.commit()
    await session.refresh(lens)
    return lens


async def delete_lens(session: AsyncSession, lens_id: int) -> None:
    lens = await get_lens(session, lens_id)
    await session.delete(lens)
    await session.commit()


async def get_lens_books(
    session: AsyncSession,
    lens_id: int,
    page: int = 1,
    per_page: int = 24,
    sort: str = "created_at",
    search: str | None = None,
) -> tuple[list[Book], int]:
    """Return paginated books matching the lens's saved filters."""
    lens = await get_lens(session, lens_id)
    fs = LensFilterState.model_validate(json.loads(lens.filter_state))
    kwargs = _fs_to_kwargs(fs)
    return await list_books(
        session,
        page=page,
        per_page=per_page,
        sort=sort,
        search=search,
        **kwargs,
    )
