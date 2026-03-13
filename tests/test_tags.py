"""Tests for tag CRUD and book-tag assignment (Step 1.10)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.shelf import Shelf
from app.models.tag import BookTag, Tag
from app.services.tag_service import (
    BookNotFound,
    TagConflict,
    TagNotFound,
    assign_tag,
    create_tag,
    delete_tag,
    list_tags,
    remove_tag,
)


# ── helpers ───────────────────────────────────────────────────────────────────


async def _make_shelf(db_session, name: str = "S") -> Shelf:
    shelf = Shelf(name=name, path="/tmp")
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _make_book(db_session, shelf_id: int, title: str = "Book") -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        format="epub",
        file_path=f"{title}.epub",
        shelf_id=shelf_id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


# ── service-level tests ───────────────────────────────────────────────────────


async def test_create_tag(db_session):
    tag = await create_tag(db_session, "fiction")
    assert tag.id is not None
    assert tag.name == "fiction"


async def test_create_tag_strips_whitespace(db_session):
    tag = await create_tag(db_session, "  sci-fi  ")
    assert tag.name == "sci-fi"


async def test_create_tag_duplicate_raises(db_session):
    await create_tag(db_session, "fantasy")
    with pytest.raises(TagConflict):
        await create_tag(db_session, "fantasy")


async def test_list_tags_empty(db_session):
    tags = await list_tags(db_session)
    assert tags == []


async def test_list_tags_sorted(db_session):
    await create_tag(db_session, "zzz")
    await create_tag(db_session, "aaa")
    await create_tag(db_session, "mmm")
    tags = await list_tags(db_session)
    assert [t.name for t in tags] == ["aaa", "mmm", "zzz"]


async def test_delete_tag(db_session):
    tag = await create_tag(db_session, "to-delete")
    await delete_tag(db_session, tag.id)
    tags = await list_tags(db_session)
    assert all(t.id != tag.id for t in tags)


async def test_delete_tag_not_found(db_session):
    with pytest.raises(TagNotFound):
        await delete_tag(db_session, 9999)


async def test_delete_tag_removes_from_books(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    tag = await create_tag(db_session, "cascade-test")
    await assign_tag(db_session, book.id, tag.id)

    await delete_tag(db_session, tag.id)

    result = await db_session.execute(select(BookTag).where(BookTag.tag_id == tag.id))
    assert result.scalars().first() is None


async def test_assign_tag(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    tag = await create_tag(db_session, "epic")

    await assign_tag(db_session, book.id, tag.id)

    result = await db_session.execute(
        select(BookTag).where(BookTag.book_id == book.id, BookTag.tag_id == tag.id)
    )
    assert result.scalar_one_or_none() is not None


async def test_assign_tag_idempotent(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    tag = await create_tag(db_session, "idempotent")

    await assign_tag(db_session, book.id, tag.id)
    await assign_tag(db_session, book.id, tag.id)  # second call — no error

    result = await db_session.execute(
        select(BookTag).where(BookTag.book_id == book.id, BookTag.tag_id == tag.id)
    )
    assert len(result.scalars().all()) == 1


async def test_assign_tag_book_not_found(db_session):
    tag = await create_tag(db_session, "orphan")
    with pytest.raises(BookNotFound):
        await assign_tag(db_session, "nonexistent-uuid", tag.id)


async def test_assign_tag_tag_not_found(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    with pytest.raises(TagNotFound):
        await assign_tag(db_session, book.id, 9999)


async def test_remove_tag(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    tag = await create_tag(db_session, "removable")
    await assign_tag(db_session, book.id, tag.id)

    await remove_tag(db_session, book.id, tag.id)

    result = await db_session.execute(
        select(BookTag).where(BookTag.book_id == book.id, BookTag.tag_id == tag.id)
    )
    assert result.scalar_one_or_none() is None


async def test_remove_tag_not_assigned(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    tag = await create_tag(db_session, "not-there")
    with pytest.raises(TagNotFound):
        await remove_tag(db_session, book.id, tag.id)


# ── API tests ─────────────────────────────────────────────────────────────────


async def test_api_list_tags_empty(client):
    resp = await client.get("/api/tags")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_api_create_tag(client):
    resp = await client.post("/api/tags", json={"name": "fantasy"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "fantasy"
    assert "id" in data


async def test_api_create_tag_empty_name(client):
    resp = await client.post("/api/tags", json={"name": "   "})
    assert resp.status_code == 422


async def test_api_create_tag_duplicate(client):
    await client.post("/api/tags", json={"name": "dup"})
    resp = await client.post("/api/tags", json={"name": "dup"})
    assert resp.status_code == 409


async def test_api_delete_tag(client):
    r = await client.post("/api/tags", json={"name": "gone"})
    tag_id = r.json()["id"]
    resp = await client.delete(f"/api/tags/{tag_id}")
    assert resp.status_code == 204
    tags = (await client.get("/api/tags")).json()
    assert all(t["id"] != tag_id for t in tags)


async def test_api_delete_tag_not_found(client):
    resp = await client.delete("/api/tags/9999")
    assert resp.status_code == 404


async def test_api_assign_tag(client, db_session):
    shelf = await _make_shelf(db_session, name="TagShelf")
    book = await _make_book(db_session, shelf.id, title="TagBook")
    r = await client.post("/api/tags", json={"name": "assigned"})
    tag_id = r.json()["id"]

    resp = await client.post(f"/api/books/{book.id}/tags/{tag_id}")
    assert resp.status_code == 204


async def test_api_assign_tag_book_not_found(client):
    r = await client.post("/api/tags", json={"name": "nowhere"})
    tag_id = r.json()["id"]
    resp = await client.post(f"/api/books/no-such-book/tags/{tag_id}")
    assert resp.status_code == 404


async def test_api_assign_tag_tag_not_found(client, db_session):
    shelf = await _make_shelf(db_session, name="AShelf")
    book = await _make_book(db_session, shelf.id, title="ABook")
    resp = await client.post(f"/api/books/{book.id}/tags/9999")
    assert resp.status_code == 404


async def test_api_remove_tag(client, db_session):
    shelf = await _make_shelf(db_session, name="RmShelf")
    book = await _make_book(db_session, shelf.id, title="RmBook")
    r = await client.post("/api/tags", json={"name": "removeme"})
    tag_id = r.json()["id"]

    await client.post(f"/api/books/{book.id}/tags/{tag_id}")
    resp = await client.delete(f"/api/books/{book.id}/tags/{tag_id}")
    assert resp.status_code == 204


async def test_api_remove_tag_not_assigned(client, db_session):
    shelf = await _make_shelf(db_session, name="NaShelf")
    book = await _make_book(db_session, shelf.id, title="NaBook")
    r = await client.post("/api/tags", json={"name": "nothere"})
    tag_id = r.json()["id"]
    resp = await client.delete(f"/api/books/{book.id}/tags/{tag_id}")
    assert resp.status_code == 404
