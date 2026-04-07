"""Tests for Lenses (saved filter preset) API."""

import uuid

from app.models.book import Book
from app.models.genre import BookGenre, Genre
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf
from app.models.tag import BookTag, Tag

# ── helpers ───────────────────────────────────────────────────────────────────


async def _make_shelf(db_session, name: str = "Shelf") -> Shelf:
    shelf = Shelf(name=name, path=f"/shelves/{name}")
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _make_book(
    db_session,
    shelf_id: int,
    title: str = "Book",
    author: str = "Author",
    fmt: str = "epub",
) -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        format=fmt,
        file_path=f"{title}.epub",
        shelf_id=shelf_id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


# ── CRUD ──────────────────────────────────────────────────────────────────────


async def test_create_lens(client):
    resp = await client.post(
        "/api/lenses",
        json={
            "name": "My Lens",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Lens"
    assert data["id"] > 0
    assert data["book_count"] == 0
    assert data["cover_book_id"] is None
    assert data["cover_book_path"] is None


async def test_list_lenses_empty(client):
    resp = await client.get("/api/lenses")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_lenses_returns_items(client):
    await client.post(
        "/api/lenses",
        json={
            "name": "Lens A",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    await client.post(
        "/api/lenses",
        json={
            "name": "Lens B",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    resp = await client.get("/api/lenses")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_get_lens(client):
    create = await client.post(
        "/api/lenses",
        json={
            "name": "Test",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]
    resp = await client.get(f"/api/lenses/{lid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test"


async def test_get_lens_not_found(client):
    resp = await client.get("/api/lenses/9999")
    assert resp.status_code == 404


async def test_update_lens_name(client):
    create = await client.post(
        "/api/lenses",
        json={
            "name": "Original",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]
    resp = await client.patch(f"/api/lenses/{lid}", json={"name": "Updated"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


async def test_update_lens_filter_state(client):
    create = await client.post(
        "/api/lenses",
        json={
            "name": "Test",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]
    resp = await client.patch(
        f"/api/lenses/{lid}",
        json={
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["pdf"],
                "mode": "or",
            }
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["filter_state"]["formats"] == ["pdf"]
    assert data["filter_state"]["mode"] == "or"


async def test_delete_lens(client):
    create = await client.post(
        "/api/lenses",
        json={
            "name": "ToDelete",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]
    del_resp = await client.delete(f"/api/lenses/{lid}")
    assert del_resp.status_code == 204
    get_resp = await client.get(f"/api/lenses/{lid}")
    assert get_resp.status_code == 404


async def test_delete_lens_not_found(client):
    resp = await client.delete("/api/lenses/9999")
    assert resp.status_code == 404


# ── book_count and cover_book_id ──────────────────────────────────────────────


async def test_lens_book_count(client, db_session):
    shelf = await _make_shelf(db_session)
    await _make_book(db_session, shelf.id, title="Book A", fmt="epub")
    await _make_book(db_session, shelf.id, title="Book B", fmt="pdf")

    create = await client.post(
        "/api/lenses",
        json={
            "name": "EPUBs",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}")
    assert resp.status_code == 200
    assert resp.json()["book_count"] == 1


async def test_lens_no_matching_books_returns_zero_count(client, db_session):
    shelf = await _make_shelf(db_session)
    await _make_book(db_session, shelf.id, fmt="epub")

    create = await client.post(
        "/api/lenses",
        json={
            "name": "PDFs only",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["pdf"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}")
    assert resp.json()["book_count"] == 0
    assert resp.json()["cover_book_id"] is None
    assert resp.json()["cover_book_path"] is None


async def test_list_lenses_includes_book_count(client, db_session):
    shelf = await _make_shelf(db_session)
    await _make_book(db_session, shelf.id, fmt="epub")

    await client.post(
        "/api/lenses",
        json={
            "name": "EPUBs",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    resp = await client.get("/api/lenses")
    assert resp.json()[0]["book_count"] == 1


async def test_lens_returns_cover_book_path(client, db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id, fmt="epub")
    book.cover_path = "/covers/lens-book.jpg"
    await db_session.commit()

    create = await client.post(
        "/api/lenses",
        json={
            "name": "EPUBs",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}")
    assert resp.status_code == 200
    assert resp.json()["cover_book_id"] == book.id
    assert resp.json()["cover_book_path"] == "/covers/lens-book.jpg"


# ── /books sub-endpoint ──────────────────────────────────────────────────────


async def test_get_lens_books(client, db_session):
    shelf = await _make_shelf(db_session)
    await _make_book(db_session, shelf.id, title="EPUB One", fmt="epub")
    await _make_book(db_session, shelf.id, title="PDF One", fmt="pdf")

    create = await client.post(
        "/api/lenses",
        json={
            "name": "EPUBs",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "EPUB One"


async def test_get_lens_books_pagination(client, db_session):
    shelf = await _make_shelf(db_session)
    for i in range(5):
        await _make_book(db_session, shelf.id, title=f"Book {i}", fmt="epub")

    create = await client.post(
        "/api/lenses",
        json={
            "name": "All",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books?page=1&per_page=2")
    assert resp.json()["total"] == 5
    assert len(resp.json()["items"]) == 2


async def test_get_lens_books_grouped_series_paginates_by_visible_entries(client, db_session):
    shelf = await _make_shelf(db_session)
    series = Series(name="Collected Lens")
    db_session.add(series)
    await db_session.commit()
    await db_session.refresh(series)

    for i in range(3):
        book = await _make_book(db_session, shelf.id, title=f"00 Lens Series {i + 1}")
        db_session.add(BookSeries(book_id=book.id, series_id=series.id, sequence=float(i + 1)))

    for i in range(25):
        await _make_book(db_session, shelf.id, title=f"{i + 1:02d} Lens Standalone")

    await db_session.commit()

    create = await client.post(
        "/api/lenses",
        json={
            "name": "All",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": ["epub"],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books?sort=title&group_by_series=true&per_page=25")
    assert resp.status_code == 200

    data = resp.json()
    assert data["total"] == 28
    assert data["pages"] == 2
    assert len(data["items"]) == 27

    resp_page_2 = await client.get(
        f"/api/lenses/{lid}/books?sort=title&group_by_series=true&per_page=25&page=2"
    )
    assert resp_page_2.status_code == 200
    assert [item["title"] for item in resp_page_2.json()["items"]] == ["25 Lens Standalone"]


async def test_get_lens_books_not_found(client):
    resp = await client.get("/api/lenses/9999/books")
    assert resp.status_code == 404


async def test_lens_books_filter_by_tag(client, db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id, title="Tagged")
    other = await _make_book(db_session, shelf.id, title="No Tag")

    tag = Tag(name="scifi")
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)

    db_session.add(BookTag(book_id=book.id, tag_id=tag.id))
    await db_session.commit()

    create = await client.post(
        "/api/lenses",
        json={
            "name": "Sci-Fi",
            "filter_state": {
                "genres": [],
                "tags": [tag.id],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["title"] == "Tagged"

    _ = other  # unused intentionally


async def test_lens_books_filter_by_genre(client, db_session):
    shelf = await _make_shelf(db_session)
    book = await _make_book(db_session, shelf.id, title="Fantasy Book")
    other = await _make_book(db_session, shelf.id, title="Other Book")

    genre = Genre(name="Fantasy")
    db_session.add(genre)
    await db_session.commit()
    await db_session.refresh(genre)

    db_session.add(BookGenre(book_id=book.id, genre_id=genre.id))
    await db_session.commit()

    create = await client.post(
        "/api/lenses",
        json={
            "name": "Fantasy",
            "filter_state": {
                "genres": [genre.id],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["title"] == "Fantasy Book"

    _ = other  # unused intentionally


async def test_lens_books_filter_by_missing_author(client, db_session):
    shelf = await _make_shelf(db_session)
    await _make_book(db_session, shelf.id, title="No Author", author=None)
    await _make_book(db_session, shelf.id, title="Named Author", author="Alice")

    create = await client.post(
        "/api/lenses",
        json={
            "name": "No Author",
            "filter_state": {
                "genres": [],
                "tags": [],
                "series_ids": [],
                "authors": [],
                "formats": [],
                "has_author": False,
                "mode": "and",
            },
        },
    )
    lid = create.json()["id"]

    resp = await client.get(f"/api/lenses/{lid}/books")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["title"] == "No Author"
