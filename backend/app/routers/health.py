from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/app")
async def app_info() -> dict[str, str | None]:
    """What the frontend needs from the server's settings."""
    url = get_settings().foyer_url.strip()
    if not url.startswith(("https://", "http://")):
        url = ""
    return {"foyer_url": url or None}
