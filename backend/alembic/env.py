from logging.config import fileConfig

from sqlalchemy import create_engine

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import all models so Alembic can detect them
import app.models  # noqa: F401, E402
from app.database import Base  # noqa: E402

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations using a synchronous engine.
    This avoids event-loop conflicts when called from an async context
    (e.g., FastAPI lifespan). The async aiosqlite URL is converted to a
    plain sqlite URL for the migration runner only.
    """
    url = config.get_main_option("sqlalchemy.url")
    # Strip async driver — Alembic uses the sync path only
    sync_url = url.replace("+aiosqlite", "")
    connectable = create_engine(sync_url)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
