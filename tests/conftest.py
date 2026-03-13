import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_session
from app.main import create_app


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    import app.models  # noqa: F401 — register all models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_session():
        async with factory() as session:
            yield session

    application = create_app()
    application.dependency_overrides[get_session] = override_get_session

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture
def shelf_factory(db_session: AsyncSession):
    async def _make(name: str = "Test Shelf", path: str = "/shelves/test", is_default: bool = False):
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
