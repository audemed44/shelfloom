from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import get_engine, Base

# Frontend build output — repo_root/frontend/dist
_FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):  # pragma: no cover
    # Import all models so their tables are registered on Base.metadata
    import app.models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background scan scheduler
    from app.services.scheduler import Scheduler
    from app.database import get_session_factory

    settings = get_settings()
    scheduler = Scheduler()
    fastapi_app.state.scheduler = scheduler
    await scheduler.start(get_session_factory(), settings, settings.covers_dir)

    yield

    await scheduler.stop()
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Shelfloom",
        description="Self-hosted book library with KOReader integration",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )

    from app.routers import (
        health,
        shelves,
        books,
        series,
        organizer,
        tags,
        import_,
        kosync,
        reading,
        fs,
        stats,
    )

    application.include_router(health.router, prefix="/api")
    application.include_router(shelves.router, prefix="/api")
    application.include_router(books.router, prefix="/api")
    application.include_router(series.router, prefix="/api")
    application.include_router(organizer.router, prefix="/api")
    application.include_router(tags.router, prefix="/api")
    application.include_router(import_.router, prefix="/api")
    application.include_router(kosync.router, prefix="/api")
    application.include_router(reading.router, prefix="/api")
    application.include_router(fs.router, prefix="/api")
    application.include_router(stats.router, prefix="/api")

    # Serve built frontend — only when dist exists (skipped in dev / CI)
    if _FRONTEND_DIST.exists():  # pragma: no cover
        assets_dir = _FRONTEND_DIST / "assets"
        if assets_dir.exists():
            application.mount(
                "/assets",
                StaticFiles(directory=str(assets_dir)),
                name="static-assets",
            )

        @application.get("/{full_path:path}", include_in_schema=False)
        async def serve_frontend(full_path: str):  # pragma: no cover
            file_path = _FRONTEND_DIST / full_path
            if file_path.is_file():
                return FileResponse(str(file_path))
            return FileResponse(str(_FRONTEND_DIST / "index.html"))

    return application


app = create_app()
