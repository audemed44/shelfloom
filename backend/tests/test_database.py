import pytest
from sqlalchemy import text

from app.database import make_engine


@pytest.mark.asyncio
async def test_sqlite_pragmas_set(tmp_path):
    """make_engine must set all required SQLite pragmas on every connection."""
    engine = make_engine(str(tmp_path / "test.db"))
    async with engine.connect() as conn:
        fk = (await conn.execute(text("PRAGMA foreign_keys"))).scalar()
        journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        sync = (await conn.execute(text("PRAGMA synchronous"))).scalar()
        busy = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
    await engine.dispose()
    assert fk == 1
    assert journal == "wal"
    assert sync == 1  # NORMAL = 1
    assert busy == 5000


@pytest.mark.asyncio
async def test_db_session_executes_raw_sql(db_session):
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_tables_created(db_engine):
    from sqlalchemy import inspect

    async with db_engine.connect() as conn:
        table_names = await conn.run_sync(lambda c: inspect(c).get_table_names())

    expected = {
        "books",
        "book_hashes",
        "shelves",
        "shelf_templates",
        "series",
        "book_series",
        "reading_orders",
        "reading_order_entries",
        "tags",
        "book_tags",
        "reading_progress",
        "reading_sessions",
        "highlights",
    }
    assert expected.issubset(set(table_names))
