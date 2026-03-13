import os

import pytest

from app.config import Settings


def test_default_values():
    # Pass _env_file=None so a local .env doesn't override the hardcoded defaults
    s = Settings(_env_file=None)
    assert s.db_path == "/data/shelfloom.db"
    assert s.scan_interval == 300
    assert s.debug is False


def test_override_via_env(monkeypatch):
    monkeypatch.setenv("SHELFLOOM_DB_PATH", "/tmp/test.db")
    monkeypatch.setenv("SHELFLOOM_SCAN_INTERVAL", "60")
    monkeypatch.setenv("SHELFLOOM_DEBUG", "true")
    s = Settings()
    assert s.db_path == "/tmp/test.db"
    assert s.scan_interval == 60
    assert s.debug is True
