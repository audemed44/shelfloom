import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings

log = logging.getLogger(__name__)

# Frontend build output — check common locations
_FRONTEND_DIST = Path(
    # In Docker: /app/frontend/dist (adjacent to backend)
    # In dev: repo_root/frontend/dist (two levels up from backend/app/)
    next(
        (
            str(p)
            for p in [
                Path(__file__).parent.parent / "frontend" / "dist",  # /app/frontend/dist
                Path(__file__).parent.parent.parent / "frontend" / "dist",  # repo/frontend/dist
            ]
            if p.exists()
        ),
        str(Path(__file__).parent.parent.parent / "frontend" / "dist"),
    )
)
_ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


def _run_migrations() -> None:  # pragma: no cover
    """
    Apply Alembic migrations to head.

    For databases created before Alembic was introduced (i.e. those built by
    SQLAlchemy's create_all with no alembic_version table), we stamp them at
    head first so upgrade becomes a no-op.
    """
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect

    from alembic import command as alembic_command

    settings = get_settings()
    cfg = Config(str(_ALEMBIC_INI))
    # Use the plain sqlite:// driver — Alembic's runner is synchronous
    sync_url = f"sqlite:///{settings.db_path}"
    cfg.set_main_option("sqlalchemy.url", sync_url)

    # Auto-stamp databases that existed before Alembic was added
    engine = create_engine(sync_url)
    with engine.connect() as conn:
        table_names = inspect(conn).get_table_names()
        if table_names and "alembic_version" not in table_names:
            alembic_command.stamp(cfg, "head")
    engine.dispose()

    alembic_command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):  # pragma: no cover
    settings = get_settings()
    import sys

    # Configure the 'app' namespace logger with its own stdout handler so
    # it is independent of the root logger level (which uvicorn may reset).
    _fmt = logging.Formatter(
        "%(asctime)s %(levelname)-8s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(_fmt)

    app_log = logging.getLogger("app")
    app_log.setLevel(settings.log_level.upper())
    app_log.addHandler(_handler)
    app_log.propagate = False  # don't double-log via root

    # Also set root to INFO for third-party libs (alembic, httpx, etc.)
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    log.info("Shelfloom started (log_level=%s)", settings.log_level.upper())

    # Import all models so Alembic and SQLAlchemy see them
    import app.models  # noqa: F401

    # Run DB migrations (creates schema on first run; applies new migrations on upgrades)
    _run_migrations()

    # Start background scan scheduler
    from app.database import get_session_factory
    from app.services.scheduler import Scheduler

    scheduler = Scheduler()
    fastapi_app.state.scheduler = scheduler
    await scheduler.start(get_session_factory(), settings, settings.covers_dir)

    yield

    await scheduler.stop()
    from app.database import get_engine

    await get_engine().dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Shelfloom",
        description="Self-hosted book library with KOReader integration",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            elapsed_ms = (time.monotonic() - start) * 1000
            log.info(
                "%s %s %s %.0fms",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
        return response

    from app.routers import (
        books,
        data_mgmt,
        fs,
        health,
        import_,
        kosync,
        organizer,
        reading,
        serials,
        series,
        shelves,
        stats,
        tags,
    )

    application.include_router(health.router, prefix="/api")
    application.include_router(shelves.router, prefix="/api")
    application.include_router(books.router, prefix="/api")
    application.include_router(series.router, prefix="/api")
    application.include_router(serials.router, prefix="/api")
    application.include_router(organizer.router, prefix="/api")
    application.include_router(tags.router, prefix="/api")
    application.include_router(import_.router, prefix="/api")
    application.include_router(kosync.router, prefix="/api")
    application.include_router(reading.router, prefix="/api")
    application.include_router(fs.router, prefix="/api")
    application.include_router(stats.router, prefix="/api")
    application.include_router(data_mgmt.router, prefix="/api")

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
            return FileResponse(
                str(_FRONTEND_DIST / "index.html"),
                headers={"Cache-Control": "no-cache"},
            )

    return application


app = create_app()
