import pytest


@pytest.mark.asyncio
async def test_health_returns_200(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_app_info_without_foyer(client, monkeypatch):
    monkeypatch.delenv("HOMEPAGE_URL", raising=False)
    response = await client.get("/api/app")
    assert response.json() == {"foyer_url": None}


@pytest.mark.asyncio
async def test_app_info_links_foyer(client, monkeypatch):
    monkeypatch.setenv("HOMEPAGE_URL", "https://home.example")
    response = await client.get("/api/app")
    assert response.json() == {"foyer_url": "https://home.example"}


@pytest.mark.asyncio
async def test_app_info_ignores_other_schemes(client, monkeypatch):
    monkeypatch.setenv("HOMEPAGE_URL", "javascript:alert(1)")
    response = await client.get("/api/app")
    assert response.json() == {"foyer_url": None}
