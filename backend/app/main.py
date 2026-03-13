from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.database import get_engine, Base


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

    from app.routers import health, shelves, books, series, organizer, tags, import_
    application.include_router(health.router, prefix="/api")
    application.include_router(shelves.router, prefix="/api")
    application.include_router(books.router, prefix="/api")
    application.include_router(series.router, prefix="/api")
    application.include_router(organizer.router, prefix="/api")
    application.include_router(tags.router, prefix="/api")
    application.include_router(import_.router, prefix="/api")

    return application


app = create_app()
