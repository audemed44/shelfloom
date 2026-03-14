"""KOSync protocol router."""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.kosync import KoSyncProgressIn, KoSyncProgressOut, KoSyncUserCreate
from app.services.kosync_service import (
    authenticate_user,
    pull_progress,
    push_progress,
    register_user,
)

router = APIRouter(prefix="/kosync", tags=["kosync"])


async def _get_authenticated_user(
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> str:
    """Decode Basic Auth header and authenticate the user. Returns username."""
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )
    try:
        decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
    except (binascii.Error, UnicodeDecodeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )

    user = await authenticate_user(session, username, password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return username


@router.put("/users/create", status_code=status.HTTP_201_CREATED)
async def create_user(
    data: KoSyncUserCreate,
    session: AsyncSession = Depends(get_session),
):
    """Register a new KOSync user."""
    user = await register_user(session, data.username, data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )
    return {"username": user.username}


@router.get("/users/auth")
async def auth_user(
    username: str = Depends(_get_authenticated_user),
):
    """Authenticate a KOSync user (Basic Auth)."""
    return {"username": username, "authorized": True}


@router.put("/syncs/progress", response_model=KoSyncProgressOut)
async def put_progress(
    data: KoSyncProgressIn,
    username: str = Depends(_get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Push reading progress from KOReader."""
    result = await push_progress(
        session,
        username=username,
        document=data.document,
        progress=data.progress,
        percentage=data.percentage,
        device=data.device,
    )
    return KoSyncProgressOut(**result)


@router.get("/syncs/progress", response_model=KoSyncProgressOut | None)
async def get_progress(
    document: str,
    username: str = Depends(_get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Pull latest reading progress for a document."""
    result = await pull_progress(session, username=username, document=document)
    if result is None:
        # KOSync spec: return empty response (not 404) for unknown document
        return None
    return KoSyncProgressOut(**result)
