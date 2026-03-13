from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.database import get_engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Import all models so their tables are registered on Base.metadata
    import app.models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
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

    from app.routers import health
    application.include_router(health.router, prefix="/api")

    return application


app = create_app()
