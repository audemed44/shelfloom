from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(db_path: str | None = None):  # pragma: no cover
    settings = get_settings()
    path = db_path or settings.db_path
    url = f"sqlite+aiosqlite:///{path}"
    return create_async_engine(url, echo=False)


def make_session_factory(engine=None):  # pragma: no cover
    if engine is None:
        engine = make_engine()
    return async_sessionmaker(engine, expire_on_commit=False)


_engine = None
_session_factory = None


def get_engine():  # pragma: no cover
    global _engine
    if _engine is None:
        _engine = make_engine()
    return _engine


def get_session_factory():  # pragma: no cover
    global _session_factory
    if _session_factory is None:
        _session_factory = make_session_factory(get_engine())
    return _session_factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:  # pragma: no cover
    factory = get_session_factory()
    async with factory() as session:
        yield session
