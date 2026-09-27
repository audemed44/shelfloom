"""KOSync protocol router.

Speaks the protocol of KOReader's built-in "Progress sync" plugin
(koreader/plugins/kosync.koplugin/api.json). In KOReader, set the custom sync
server to ``http(s)://<shelfloom-host>/api/kosync``.

KOReader authenticates with ``x-auth-user`` / ``x-auth-key`` headers (the key is
md5 of the password). HTTP Basic auth is also accepted.
"""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, Depends, Header, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.kosync import KoSyncProgressIn, KoSyncUserCreate
from app.services.kosync_service import (
    authenticate_key,
    authenticate_user,
    pull_progress,
    push_progress,
    register_user,
)

router = APIRouter(prefix="/kosync", tags=["kosync"])

# Error bodies follow the reference koreader-sync-server.
_UNAUTHORIZED = {"code": 2001, "message": "Unauthorized"}
_USER_EXISTS = {"code": 2002, "message": "Username is already registered."}


class _AuthError(Exception):
    pass


async def _get_authenticated_user(
    x_auth_user: str | None = Header(None),
    x_auth_key: str | None = Header(None),
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> str | None:
    """Return the authenticated username, or None if the credentials are bad."""
    if x_auth_user and x_auth_key:
        user = await authenticate_key(session, x_auth_user, x_auth_key)
        return user.username if user else None
    if authorization and authorization.startswith("Basic "):
        try:
            decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            return None
        username, _, password = decoded.partition(":")
        user = await authenticate_user(session, username, password)
        return user.username if user else None
    return None


def _unauthorized() -> JSONResponse:
    return JSONResponse(
        _UNAUTHORIZED,
        status_code=status.HTTP_401_UNAUTHORIZED,
        headers={"WWW-Authenticate": "Basic"},
    )


async def _create_user(data: KoSyncUserCreate, session: AsyncSession) -> JSONResponse:
    user = await register_user(session, data.username, data.password)
    if user is None:
        return JSONResponse(_USER_EXISTS, status_code=status.HTTP_402_PAYMENT_REQUIRED)
    return JSONResponse({"username": user.username}, status_code=status.HTTP_201_CREATED)


@router.post("/users/create", status_code=status.HTTP_201_CREATED)
async def create_user(data: KoSyncUserCreate, session: AsyncSession = Depends(get_session)):
    """Register a user. KOReader sends md5(password) as the password."""
    return await _create_user(data, session)


@router.put("/users/create", status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_user_put(data: KoSyncUserCreate, session: AsyncSession = Depends(get_session)):
    """Older form of registration, kept for existing clients."""
    return await _create_user(data, session)


@router.get("/users/auth")
async def auth_user(username: str | None = Depends(_get_authenticated_user)):
    """Check credentials."""
    if username is None:
        return _unauthorized()
    return {"authorized": "OK", "username": username}


@router.put("/syncs/progress")
async def put_progress(
    data: KoSyncProgressIn,
    username: str | None = Depends(_get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Store a device's reading position."""
    if username is None:
        return _unauthorized()
    return await push_progress(
        session,
        username=username,
        document=data.document,
        progress=data.progress,
        percentage=data.percentage,
        device=data.device,
        device_id=data.device_id,
    )


async def _get_progress(document: str, username: str | None, session: AsyncSession):
    if username is None:
        return _unauthorized()
    # KOReader expects an empty object, not null or 404, for an unknown document.
    return await pull_progress(session, username=username, document=document) or {}


@router.get("/syncs/progress/{document}")
async def get_progress(
    document: str,
    username: str | None = Depends(_get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Latest position for a document (newest across devices wins)."""
    return await _get_progress(document, username, session)


@router.get("/syncs/progress", include_in_schema=False)
async def get_progress_query(
    document: str,
    username: str | None = Depends(_get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Older form with the document as a query parameter."""
    return await _get_progress(document, username, session)
