from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SHELFLOOM_", env_file=".env", extra="ignore")

    db_path: str = "/data/shelfloom.db"
    covers_dir: str = "/data/covers"
    default_shelf_path: str = "/shelves/library"
    default_shelf_name: str = "Library"
    koreader_path: str = "/koreader"
    scan_interval: int = 300  # seconds
    debug: bool = False


def get_settings() -> Settings:
    return Settings()
