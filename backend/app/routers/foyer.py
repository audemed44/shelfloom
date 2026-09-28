"""Foyer dashboard widget (see app.services.foyer_widget for the format)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.foyer_widget import build_widget

router = APIRouter(prefix="/foyer", tags=["foyer"])


@router.get("/widget")
async def widget(session: AsyncSession = Depends(get_session)) -> dict:
    """Reading summary for a Foyer dashboard card."""
    return await build_widget(session)
