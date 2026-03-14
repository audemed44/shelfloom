import pytest
from sqlalchemy import text


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
