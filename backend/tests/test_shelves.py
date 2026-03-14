"""Tests for shelf management API and service."""

import uuid

from httpx import AsyncClient

from app.models.book import Book

# ── helper ────────────────────────────────────────────────────────────────────


async def create_shelf(
    client: AsyncClient, name: str = "My Shelf", path: str = "/tmp", **kw
) -> dict:
    resp = await client.post("/api/shelves", json={"name": name, "path": path, **kw})
    return resp


# ── list ──────────────────────────────────────────────────────────────────────


async def test_list_shelves_empty(client):
    resp = await client.get("/api/shelves")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_shelves_with_data(client, tmp_path):
    path = str(tmp_path)
    await client.post("/api/shelves", json={"name": "A", "path": path})
    await client.post("/api/shelves", json={"name": "B", "path": path})
    resp = await client.get("/api/shelves")
    assert resp.status_code == 200
    names = [s["name"] for s in resp.json()]
    assert "A" in names and "B" in names


# ── create ────────────────────────────────────────────────────────────────────


async def test_create_shelf(client, tmp_path):
    resp = await client.post("/api/shelves", json={"name": "Library", "path": str(tmp_path)})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Library"
    assert data["book_count"] == 0
    assert data["is_default"] is False


async def test_create_shelf_path_must_exist(client):
    resp = await client.post("/api/shelves", json={"name": "X", "path": "/nonexistent/path"})
    assert resp.status_code == 422


async def test_create_shelf_name_unique(client, tmp_path):
    path = str(tmp_path)
    await client.post("/api/shelves", json={"name": "Dup", "path": path})
    resp = await client.post("/api/shelves", json={"name": "Dup", "path": path})
    assert resp.status_code == 409


async def test_create_shelf_as_default(client, tmp_path):
    resp = await client.post(
        "/api/shelves", json={"name": "Main", "path": str(tmp_path), "is_default": True}
    )
    assert resp.status_code == 201
    assert resp.json()["is_default"] is True


async def test_only_one_default_shelf(client, tmp_path):
    path = str(tmp_path)
    await client.post("/api/shelves", json={"name": "A", "path": path, "is_default": True})
    await client.post("/api/shelves", json={"name": "B", "path": path, "is_default": True})
    resp = await client.get("/api/shelves")
    defaults = [s for s in resp.json() if s["is_default"]]
    assert len(defaults) == 1
    assert defaults[0]["name"] == "B"


# ── get ───────────────────────────────────────────────────────────────────────


async def test_get_shelf(client, tmp_path):
    created = (await client.post("/api/shelves", json={"name": "S", "path": str(tmp_path)})).json()
    resp = await client.get(f"/api/shelves/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "S"


async def test_get_shelf_not_found(client):
    resp = await client.get("/api/shelves/99999")
    assert resp.status_code == 404


# ── update ────────────────────────────────────────────────────────────────────


async def test_update_shelf_name(client, tmp_path):
    created = (
        await client.post("/api/shelves", json={"name": "Old", "path": str(tmp_path)})
    ).json()
    resp = await client.patch(f"/api/shelves/{created['id']}", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


async def test_update_shelf_not_found(client):
    resp = await client.patch("/api/shelves/99999", json={"name": "X"})
    assert resp.status_code == 404


async def test_update_shelf_full(client, tmp_path):
    """Patch all optional fields to cover all update_shelf branches."""
    path = str(tmp_path)
    created = (await client.post("/api/shelves", json={"name": "Upd", "path": path})).json()
    resp = await client.patch(
        f"/api/shelves/{created['id']}",
        json={
            "is_default": True,
            "is_sync_target": True,
            "device_name": "Kobo",
            "auto_organize": True,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_default"] is True
    assert data["is_sync_target"] is True
    assert data["device_name"] == "Kobo"
    assert data["auto_organize"] is True


async def test_update_shelf_name_conflict(client, tmp_path):
    path = str(tmp_path)
    a = (await client.post("/api/shelves", json={"name": "A", "path": path})).json()
    await client.post("/api/shelves", json={"name": "B", "path": path})
    resp = await client.patch(f"/api/shelves/{a['id']}", json={"name": "B"})
    assert resp.status_code == 409


# ── delete ────────────────────────────────────────────────────────────────────


async def test_delete_shelf(client, tmp_path):
    created = (
        await client.post("/api/shelves", json={"name": "Del", "path": str(tmp_path)})
    ).json()
    resp = await client.delete(f"/api/shelves/{created['id']}")
    assert resp.status_code == 204
    # Verify gone
    assert (await client.get(f"/api/shelves/{created['id']}")).status_code == 404


async def test_delete_shelf_not_found(client):
    resp = await client.delete("/api/shelves/99999")
    assert resp.status_code == 404


async def test_cannot_delete_shelf_with_books(client, db_session, tmp_path):
    created = (
        await client.post("/api/shelves", json={"name": "Full", "path": str(tmp_path)})
    ).json()
    # Add a book directly via DB
    book = Book(
        id=str(uuid.uuid4()),
        title="Test",
        format="epub",
        file_path="test.epub",
        shelf_id=created["id"],
    )
    db_session.add(book)
    await db_session.commit()

    resp = await client.delete(f"/api/shelves/{created['id']}")
    assert resp.status_code == 409
    assert "book" in resp.json()["detail"].lower()


# ── book count ────────────────────────────────────────────────────────────────


async def test_shelf_book_count(client, db_session, tmp_path):
    created = (
        await client.post("/api/shelves", json={"name": "Cnt", "path": str(tmp_path)})
    ).json()
    for i in range(3):
        db_session.add(
            Book(
                id=str(uuid.uuid4()),
                title=f"Book {i}",
                format="epub",
                file_path=f"book{i}.epub",
                shelf_id=created["id"],
            )
        )
    await db_session.commit()

    resp = await client.get(f"/api/shelves/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["book_count"] == 3


# ── organize template ─────────────────────────────────────────────────────────


async def test_create_shelf_with_organize_template(client, tmp_path):
    resp = await client.post(
        "/api/shelves",
        json={
            "name": "Organized",
            "path": str(tmp_path),
            "auto_organize": True,
            "organize_template": "{author}/{series_path}/{sequence} - {title}",
            "seq_pad": 3,
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["organize_template"] == "{author}/{series_path}/{sequence} - {title}"
    assert data["seq_pad"] == 3


async def test_create_shelf_without_template_returns_null(client, tmp_path):
    resp = await client.post("/api/shelves", json={"name": "Plain", "path": str(tmp_path)})
    assert resp.status_code == 201
    data = resp.json()
    assert data["organize_template"] is None
    assert data["seq_pad"] == 2


async def test_update_shelf_organize_template(client, tmp_path):
    created = (
        await client.post("/api/shelves", json={"name": "UpdTmpl", "path": str(tmp_path)})
    ).json()
    resp = await client.patch(
        f"/api/shelves/{created['id']}",
        json={"organize_template": "{author}/{title}.{format}", "seq_pad": 4},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["organize_template"] == "{author}/{title}.{format}"
    assert data["seq_pad"] == 4


async def test_update_shelf_template_overwrites_existing(client, tmp_path):
    created = (
        await client.post(
            "/api/shelves",
            json={
                "name": "Overwrite",
                "path": str(tmp_path),
                "organize_template": "{title}",
            },
        )
    ).json()
    assert created["organize_template"] == "{title}"

    resp = await client.patch(
        f"/api/shelves/{created['id']}",
        json={"organize_template": "{author}/{title}"},
    )
    assert resp.status_code == 200
    assert resp.json()["organize_template"] == "{author}/{title}"


# ── schema validation ─────────────────────────────────────────────────────────


async def test_create_shelf_missing_name(client):
    resp = await client.post("/api/shelves", json={"path": "/tmp"})
    assert resp.status_code == 422


async def test_create_shelf_missing_path(client):
    resp = await client.post("/api/shelves", json={"name": "X"})
    assert resp.status_code == 422


async def test_create_shelf_empty_name(client):
    resp = await client.post("/api/shelves", json={"name": "  ", "path": "/tmp"})
    assert resp.status_code == 422
