"""Tests for genre CRUD and book-genre assignment."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.genre import BookGenre
from app.models.shelf import Shelf
from app.services.genre_service import (
    BookNotFound,
    GenreConflict,
    GenreNotFound,
    assign_genre,
    create_genre,
    delete_genre,
    list_genres,
    remove_genre,
)


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


async def test_create_genre(db_session):
    genre = await create_genre(db_session, "Fantasy")
    assert genre.id is not None
    assert genre.name == "Fantasy"


async def test_create_genre_strips_whitespace(db_session):
    genre = await create_genre(db_session, "  Sci-Fi  ")
    assert genre.name == "Sci-Fi"


async def test_create_genre_duplicate_raises_case_insensitively(db_session):
    await create_genre(db_session, "Fantasy")
    with pytest.raises(GenreConflict):
        await create_genre(db_session, "fantasy")


async def test_list_genres_empty(db_session):
    genres = await list_genres(db_session)
    assert genres == []


async def test_list_genres_sorted(db_session):
    await create_genre(db_session, "zzz")
    await create_genre(db_session, "aaa")
    await create_genre(db_session, "mmm")
    genres = await list_genres(db_session)
    assert [g.name for g in genres] == ["aaa", "mmm", "zzz"]


async def test_delete_genre(db_session):
    genre = await create_genre(db_session, "to-delete")
    await delete_genre(db_session, genre.id)
    genres = await list_genres(db_session)
    assert all(g.id != genre.id for g in genres)


async def test_delete_genre_not_found(db_session):
    with pytest.raises(GenreNotFound):
        await delete_genre(db_session, 9999)


async def test_delete_genre_removes_from_books(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    genre = await create_genre(db_session, "cascade-test")
    await assign_genre(db_session, book.id, genre.id)

    await delete_genre(db_session, genre.id)

    result = await db_session.execute(select(BookGenre).where(BookGenre.genre_id == genre.id))
    assert result.scalars().first() is None


async def test_assign_genre(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    genre = await create_genre(db_session, "epic")

    await assign_genre(db_session, book.id, genre.id)

    result = await db_session.execute(
        select(BookGenre).where(BookGenre.book_id == book.id, BookGenre.genre_id == genre.id)
    )
    assert result.scalar_one_or_none() is not None


async def test_assign_genre_idempotent(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    genre = await create_genre(db_session, "idempotent")

    await assign_genre(db_session, book.id, genre.id)
    await assign_genre(db_session, book.id, genre.id)

    result = await db_session.execute(
        select(BookGenre).where(BookGenre.book_id == book.id, BookGenre.genre_id == genre.id)
    )
    assert len(result.scalars().all()) == 1


async def test_assign_genre_book_not_found(db_session):
    genre = await create_genre(db_session, "orphan")
    with pytest.raises(BookNotFound):
        await assign_genre(db_session, "nonexistent-uuid", genre.id)


async def test_assign_genre_genre_not_found(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    with pytest.raises(GenreNotFound):
        await assign_genre(db_session, book.id, 9999)


async def test_remove_genre(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    genre = await create_genre(db_session, "removable")
    await assign_genre(db_session, book.id, genre.id)

    await remove_genre(db_session, book.id, genre.id)

    result = await db_session.execute(
        select(BookGenre).where(BookGenre.book_id == book.id, BookGenre.genre_id == genre.id)
    )
    assert result.scalar_one_or_none() is None


async def test_remove_genre_not_assigned(db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id)
    genre = await create_genre(db_session, "not-there")
    with pytest.raises(GenreNotFound):
        await remove_genre(db_session, book.id, genre.id)


async def test_api_list_genres_empty(client):
    resp = await client.get("/api/genres")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_api_create_genre(client):
    resp = await client.post("/api/genres", json={"name": "Fantasy"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Fantasy"
    assert "id" in data


async def test_api_create_genre_empty_name(client):
    resp = await client.post("/api/genres", json={"name": "   "})
    assert resp.status_code == 422


async def test_api_create_genre_duplicate_case_insensitive(client):
    await client.post("/api/genres", json={"name": "Fantasy"})
    resp = await client.post("/api/genres", json={"name": "fantasy"})
    assert resp.status_code == 409


async def test_api_delete_genre(client):
    r = await client.post("/api/genres", json={"name": "Gone"})
    genre_id = r.json()["id"]
    resp = await client.delete(f"/api/genres/{genre_id}")
    assert resp.status_code == 204
    genres = (await client.get("/api/genres")).json()
    assert all(g["id"] != genre_id for g in genres)


async def test_api_delete_genre_not_found(client):
    resp = await client.delete("/api/genres/9999")
    assert resp.status_code == 404


async def test_api_assign_genre(client, db_session):
    shelf = await _make_shelf(db_session, name="GenreShelf")
    book = await _make_book(db_session, shelf.id, title="GenreBook")
    r = await client.post("/api/genres", json={"name": "Assigned"})
    genre_id = r.json()["id"]

    resp = await client.post(f"/api/books/{book.id}/genres/{genre_id}")
    assert resp.status_code == 204


async def test_api_assign_genre_book_not_found(client):
    r = await client.post("/api/genres", json={"name": "Nowhere"})
    genre_id = r.json()["id"]
    resp = await client.post(f"/api/books/no-such-book/genres/{genre_id}")
    assert resp.status_code == 404


async def test_api_assign_genre_genre_not_found(client, db_session):
    shelf = await _make_shelf(db_session, name="AShelf")
    book = await _make_book(db_session, shelf.id, title="ABook")
    resp = await client.post(f"/api/books/{book.id}/genres/9999")
    assert resp.status_code == 404


async def test_api_remove_genre(client, db_session):
    shelf = await _make_shelf(db_session, name="RmShelf")
    book = await _make_book(db_session, shelf.id, title="RmBook")
    r = await client.post("/api/genres", json={"name": "RemoveMe"})
    genre_id = r.json()["id"]

    await client.post(f"/api/books/{book.id}/genres/{genre_id}")
    resp = await client.delete(f"/api/books/{book.id}/genres/{genre_id}")
    assert resp.status_code == 204


async def test_api_remove_genre_not_assigned(client, db_session):
    shelf = await _make_shelf(db_session, name="NaShelf")
    book = await _make_book(db_session, shelf.id, title="NaBook")
    r = await client.post("/api/genres", json={"name": "NotThere"})
    genre_id = r.json()["id"]
    resp = await client.delete(f"/api/books/{book.id}/genres/{genre_id}")
    assert resp.status_code == 404


async def test_api_book_response_includes_normalized_genres(client, db_session):
    shelf = await _make_shelf(db_session, name="DetailShelf")
    book = await _make_book(db_session, shelf.id, title="DetailBook")
    genre_resp = await client.post("/api/genres", json={"name": "Fantasy"})
    genre_id = genre_resp.json()["id"]
    await client.post(f"/api/books/{book.id}/genres/{genre_id}")

    resp = await client.get(f"/api/books/{book.id}")
    assert resp.status_code == 200
    assert resp.json()["genres"] == [{"id": genre_id, "name": "Fantasy"}]
