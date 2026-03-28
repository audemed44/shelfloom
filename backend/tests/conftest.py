import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.database import Base, get_session, make_engine
from app.main import create_app


def _worker_id() -> str:
    return os.environ.get("PYTEST_XDIST_WORKER", "gw0")


async def _clear_database(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
        sequence_exists = await conn.scalar(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
        )
        if sequence_exists:
            await conn.execute(text("DELETE FROM sqlite_sequence"))


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_engine(tmp_path_factory):
    db_dir = tmp_path_factory.mktemp("pytest-db")
    db_path = db_dir / f"{_worker_id()}.sqlite"
    engine = make_engine(str(db_path))
    import app.models  # noqa: F401 — register all models

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture(scope="session")
def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def reset_db(db_engine):
    yield
    await _clear_database(db_engine)


@pytest_asyncio.fixture
async def db_session(reset_db, session_factory):
    async with session_factory() as session:
        yield session


@pytest.fixture(scope="session")
def test_app(session_factory):
    async def override_get_session():
        async with session_factory() as session:
            yield session

    application = create_app()
    application.dependency_overrides[get_session] = override_get_session
    application.state.serial_fetch_session_factory = session_factory
    return application


@pytest_asyncio.fixture
async def client(reset_db, test_app):
    from app.services.scheduler import Scheduler
    from app.services.serial_service import reset_chapter_fetch_jobs

    test_app.state.scheduler = Scheduler()
    reset_chapter_fetch_jobs()

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as ac:
        ac.app = test_app  # expose app for tests that need app.state
        yield ac

    reset_chapter_fetch_jobs()


@pytest.fixture
def shelf_factory(db_session: AsyncSession):
    async def _make(
        name: str = "Test Shelf", path: str = "/shelves/test", is_default: bool = False
    ):
        from app.models.shelf import Shelf

        shelf = Shelf(name=name, path=path, is_default=is_default)
        db_session.add(shelf)
        await db_session.commit()
        await db_session.refresh(shelf)
        return shelf

    return _make


@pytest.fixture
def book_factory(db_session: AsyncSession):
    import uuid

    async def _make(
        title: str = "Test Book",
        author: str | None = "Test Author",
        shelf_id: int = 1,
        format: str = "epub",
        file_path: str = "test.epub",
    ):
        from app.models.book import Book

        book = Book(
            id=str(uuid.uuid4()),
            title=title,
            author=author,
            shelf_id=shelf_id,
            format=format,
            file_path=file_path,
        )
        db_session.add(book)
        await db_session.commit()
        await db_session.refresh(book)
        return book

    return _make
