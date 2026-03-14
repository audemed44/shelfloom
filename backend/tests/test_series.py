"""Tests for Series and Reading Order API."""

import uuid

import pytest
from sqlalchemy import select

from app.models.book import Book
from app.models.series import BookSeries, ReadingOrder, ReadingOrderEntry, Series
from app.models.shelf import Shelf


# ── helpers ───────────────────────────────────────────────────────────────────


async def _create_shelf(db_session, tmp_path) -> Shelf:
    shelf = Shelf(name=f"S-{uuid.uuid4().hex[:4]}", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _create_book(db_session, shelf_id: int, title: str = "Book") -> Book:
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


# ── series CRUD ───────────────────────────────────────────────────────────────


async def test_create_top_level_series(client):
    resp = await client.post("/api/series", json={"name": "Cosmere"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Cosmere"
    assert resp.json()["parent_id"] is None


async def test_create_sub_series(client):
    parent = (await client.post("/api/series", json={"name": "Cosmere"})).json()
    resp = await client.post(
        "/api/series", json={"name": "Stormlight", "parent_id": parent["id"]}
    )
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == parent["id"]


async def test_create_sub_series_invalid_parent(client):
    resp = await client.post("/api/series", json={"name": "S", "parent_id": 99999})
    assert resp.status_code == 404


async def test_list_series(client):
    await client.post("/api/series", json={"name": "A"})
    await client.post("/api/series", json={"name": "B"})
    resp = await client.get("/api/series")
    assert resp.status_code == 200
    names = [s["name"] for s in resp.json()]
    assert "A" in names and "B" in names


async def test_get_series(client):
    created = (await client.post("/api/series", json={"name": "Target"})).json()
    resp = await client.get(f"/api/series/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Target"


async def test_get_series_not_found(client):
    resp = await client.get("/api/series/99999")
    assert resp.status_code == 404


async def test_update_series(client):
    created = (await client.post("/api/series", json={"name": "Old"})).json()
    resp = await client.patch(f"/api/series/{created['id']}", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


async def test_update_series_not_found(client):
    resp = await client.patch("/api/series/99999", json={"name": "X"})
    assert resp.status_code == 404


async def test_delete_series(client):
    created = (await client.post("/api/series", json={"name": "Del"})).json()
    resp = await client.delete(f"/api/series/{created['id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/series/{created['id']}")).status_code == 404


async def test_delete_series_not_found(client):
    resp = await client.delete("/api/series/99999")
    assert resp.status_code == 404


async def test_multi_level_series(client):
    """Cosmere → Stormlight → (books)"""
    cosmos = (await client.post("/api/series", json={"name": "Cosmere"})).json()
    storm = (
        await client.post(
            "/api/series", json={"name": "Stormlight", "parent_id": cosmos["id"]}
        )
    ).json()

    resp = await client.get(f"/api/series/{storm['id']}")
    assert resp.json()["parent_id"] == cosmos["id"]


# ── book ↔ series ─────────────────────────────────────────────────────────────


async def test_add_book_to_series(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Way of Kings")
    series = (await client.post("/api/series", json={"name": "Stormlight"})).json()

    resp = await client.post(f"/api/series/{series['id']}/books/{book.id}?sequence=1")
    assert resp.status_code == 201
    assert resp.json()["sequence"] == 1.0


async def test_add_book_fractional_sequence(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Novella")
    series = (await client.post("/api/series", json={"name": "S"})).json()

    resp = await client.post(f"/api/series/{series['id']}/books/{book.id}?sequence=2.5")
    assert resp.status_code == 201
    assert resp.json()["sequence"] == 2.5


async def test_book_in_multiple_series(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Multi")
    s1 = (await client.post("/api/series", json={"name": "S1"})).json()
    s2 = (await client.post("/api/series", json={"name": "S2"})).json()

    await client.post(f"/api/series/{s1['id']}/books/{book.id}?sequence=1")
    await client.post(f"/api/series/{s2['id']}/books/{book.id}?sequence=3")

    result = await db_session.execute(
        select(BookSeries).where(BookSeries.book_id == book.id)
    )
    entries = result.scalars().all()
    assert len(entries) == 2


async def test_remove_book_from_series(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Remove")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    await client.post(f"/api/series/{series['id']}/books/{book.id}?sequence=1")

    resp = await client.delete(f"/api/series/{series['id']}/books/{book.id}")
    assert resp.status_code == 204

    result = await db_session.execute(
        select(BookSeries).where(BookSeries.book_id == book.id)
    )
    assert result.scalars().all() == []


async def test_add_book_series_not_found(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id)
    resp = await client.post(f"/api/series/99999/books/{book.id}")
    assert resp.status_code == 404


async def test_add_book_book_not_found(client):
    series = (await client.post("/api/series", json={"name": "S"})).json()
    resp = await client.post(f"/api/series/{series['id']}/books/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_series_books_unlinked(client, db_session, tmp_path):
    """Deleting a series doesn't delete the books."""
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Survives")
    series = (await client.post("/api/series", json={"name": "TempSeries"})).json()
    await client.post(f"/api/series/{series['id']}/books/{book.id}?sequence=1")

    await client.delete(f"/api/series/{series['id']}")

    result = await db_session.execute(select(Book).where(Book.id == book.id))
    assert result.scalar_one_or_none() is not None


# ── series tree ───────────────────────────────────────────────────────────────


async def test_series_tree(client):
    parent = (await client.post("/api/series", json={"name": "Parent"})).json()
    (
        await client.post(
            "/api/series", json={"name": "Child", "parent_id": parent["id"]}
        )
    )

    resp = await client.get("/api/series/tree")
    assert resp.status_code == 200
    names = [row["name"] for row in resp.json()]
    assert "Parent" in names and "Child" in names


# ── reading orders ────────────────────────────────────────────────────────────


async def test_create_reading_order(client):
    series = (await client.post("/api/series", json={"name": "Cosmere"})).json()
    resp = await client.post(
        "/api/reading-orders",
        json={"name": "Publication Order", "series_id": series["id"]},
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Publication Order"


async def test_create_reading_order_prepopulates_entries(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book1 = await _create_book(db_session, shelf.id, "Book One")
    book2 = await _create_book(db_session, shelf.id, "Book Two")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    # add books to series with explicit sequence
    await client.post(
        f"/api/series/{series['id']}/books/{book1.id}", json={"sequence": 1}
    )
    await client.post(
        f"/api/series/{series['id']}/books/{book2.id}", json={"sequence": 2}
    )
    ro = (
        await client.post(
            "/api/reading-orders",
            json={"name": "R", "series_id": series["id"]},
        )
    ).json()
    detail = (await client.get(f"/api/reading-orders/{ro['id']}")).json()
    entries = sorted(detail["entries"], key=lambda e: e["position"])
    assert len(entries) == 2
    assert entries[0]["book_id"] == book1.id
    assert entries[0]["position"] == 1
    assert entries[1]["book_id"] == book2.id
    assert entries[1]["position"] == 2


async def test_create_reading_order_series_not_found(client):
    resp = await client.post(
        "/api/reading-orders", json={"name": "X", "series_id": 99999}
    )
    assert resp.status_code == 404


async def test_get_reading_order(client):
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()
    resp = await client.get(f"/api/reading-orders/{ro['id']}")
    assert resp.status_code == 200


async def test_get_reading_order_not_found(client):
    assert (await client.get("/api/reading-orders/99999")).status_code == 404


async def test_delete_reading_order(client):
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()
    resp = await client.delete(f"/api/reading-orders/{ro['id']}")
    assert resp.status_code == 204


async def test_delete_reading_order_not_found(client):
    assert (await client.delete("/api/reading-orders/99999")).status_code == 404


async def test_add_reading_order_entry(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Entry Book")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()

    resp = await client.post(
        f"/api/reading-orders/{ro['id']}/entries",
        json={"book_id": book.id, "position": 1},
    )
    assert resp.status_code == 201
    assert resp.json()["position"] == 1


async def test_add_entry_reading_order_not_found(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id)
    resp = await client.post(
        "/api/reading-orders/99999/entries", json={"book_id": book.id, "position": 1}
    )
    assert resp.status_code == 404


async def test_add_entry_book_not_found(client):
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()
    resp = await client.post(
        f"/api/reading-orders/{ro['id']}/entries",
        json={"book_id": str(uuid.uuid4()), "position": 1},
    )
    assert resp.status_code == 404


async def test_reorder_entries(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book1 = await _create_book(db_session, shelf.id, "B1")
    book2 = await _create_book(db_session, shelf.id, "B2")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()

    e1 = (
        await client.post(
            f"/api/reading-orders/{ro['id']}/entries",
            json={"book_id": book1.id, "position": 1},
        )
    ).json()
    e2 = (
        await client.post(
            f"/api/reading-orders/{ro['id']}/entries",
            json={"book_id": book2.id, "position": 2},
        )
    ).json()

    resp = await client.patch(
        f"/api/reading-orders/{ro['id']}/entries/reorder",
        json=[{"id": e1["id"], "position": 2}, {"id": e2["id"], "position": 1}],
    )
    assert resp.status_code == 204

    result = await db_session.execute(
        select(ReadingOrderEntry).where(ReadingOrderEntry.id == e1["id"])
    )
    assert result.scalar_one().position == 2


async def test_delete_reading_order_books_unaffected(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Safe")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()
    await client.post(
        f"/api/reading-orders/{ro['id']}/entries",
        json={"book_id": book.id, "position": 1},
    )

    await client.delete(f"/api/reading-orders/{ro['id']}")

    result = await db_session.execute(select(Book).where(Book.id == book.id))
    assert result.scalar_one_or_none() is not None


# ── purge empty series ────────────────────────────────────────────────────────


async def test_purge_empty_series_removes_empty(client):
    """Series with no books and no children is deleted."""
    s = (await client.post("/api/series", json={"name": "Empty Series"})).json()
    resp = await client.delete("/api/series/empty")
    assert resp.status_code == 200
    data = resp.json()
    assert "Empty Series" in data["deleted"]
    assert data["count"] >= 1
    assert (await client.get(f"/api/series/{s['id']}")).status_code == 404


async def test_purge_empty_series_cascades_to_parent(client):
    """Deleting empty child makes parent empty, which is then also deleted."""
    parent = (await client.post("/api/series", json={"name": "Cosmere"})).json()
    child = (
        await client.post(
            "/api/series",
            json={"name": "Stormlight Archive", "parent_id": parent["id"]},
        )
    ).json()

    resp = await client.delete("/api/series/empty")
    assert resp.status_code == 200
    deleted = resp.json()["deleted"]
    assert "Stormlight Archive" in deleted
    assert "Cosmere" in deleted


async def test_purge_empty_series_keeps_series_with_books(client, db_session, tmp_path):
    """Series that has a book is not deleted."""
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Keep Me")
    s = (await client.post("/api/series", json={"name": "Has Books"})).json()
    await client.post(f"/api/series/{s['id']}/books/{book.id}")

    resp = await client.delete("/api/series/empty")
    assert s["name"] not in resp.json()["deleted"]
    assert (await client.get(f"/api/series/{s['id']}")).status_code == 200


async def test_purge_empty_series_keeps_parent_with_books(client, db_session, tmp_path):
    """Parent series is kept if a sibling child still has books."""
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "A Book")
    parent = (await client.post("/api/series", json={"name": "Parent"})).json()
    child_with = (
        await client.post(
            "/api/series", json={"name": "Child With Books", "parent_id": parent["id"]}
        )
    ).json()
    await client.post(
        "/api/series", json={"name": "Child Empty", "parent_id": parent["id"]}
    )
    await client.post(f"/api/series/{child_with['id']}/books/{book.id}")

    resp = await client.delete("/api/series/empty")
    deleted = resp.json()["deleted"]
    assert "Child Empty" in deleted
    assert "Parent" not in deleted
    assert "Child With Books" not in deleted


async def test_purge_empty_series_noop_when_nothing_empty(client):
    """Returns empty list when nothing to delete."""
    resp = await client.delete("/api/series/empty")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


# ── new endpoints: list reading orders for series, list books in series ────────


async def test_list_series_reading_orders(client):
    series = (await client.post("/api/series", json={"name": "Cosmere"})).json()
    await client.post(
        "/api/reading-orders",
        json={"name": "Publication Order", "series_id": series["id"]},
    )
    await client.post(
        "/api/reading-orders",
        json={"name": "Chronological Order", "series_id": series["id"]},
    )

    resp = await client.get(f"/api/series/{series['id']}/reading-orders")
    assert resp.status_code == 200
    names = [ro["name"] for ro in resp.json()]
    assert "Publication Order" in names
    assert "Chronological Order" in names


async def test_list_series_reading_orders_not_found(client):
    resp = await client.get("/api/series/99999/reading-orders")
    assert resp.status_code == 404


async def test_list_series_books(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book1 = await _create_book(db_session, shelf.id, "The Way of Kings")
    book2 = await _create_book(db_session, shelf.id, "Words of Radiance")
    series = (await client.post("/api/series", json={"name": "Stormlight"})).json()
    await client.post(f"/api/series/{series['id']}/books/{book1.id}?sequence=1")
    await client.post(f"/api/series/{series['id']}/books/{book2.id}?sequence=2")

    resp = await client.get(f"/api/series/{series['id']}/books")
    assert resp.status_code == 200
    titles = [b["title"] for b in resp.json()]
    assert "The Way of Kings" in titles
    assert "Words of Radiance" in titles


async def test_list_series_books_not_found(client):
    resp = await client.get("/api/series/99999/books")
    assert resp.status_code == 404


async def test_get_reading_order_includes_entries(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    book1 = await _create_book(db_session, shelf.id, "Book A")
    book2 = await _create_book(db_session, shelf.id, "Book B")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()
    await client.post(
        f"/api/reading-orders/{ro['id']}/entries",
        json={"book_id": book1.id, "position": 1},
    )
    await client.post(
        f"/api/reading-orders/{ro['id']}/entries",
        json={"book_id": book2.id, "position": 2},
    )

    resp = await client.get(f"/api/reading-orders/{ro['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data
    assert len(data["entries"]) == 2
    # Book info should be embedded in each entry
    entry = data["entries"][0]
    assert "title" in entry
    assert entry["title"] is not None


async def test_reading_order_entries_include_book_info(client, db_session, tmp_path):
    """Entries returned by both the detail endpoint and the series list carry book metadata."""
    shelf = await _create_shelf(db_session, tmp_path)
    book = await _create_book(db_session, shelf.id, "Embedded Title")
    series = (await client.post("/api/series", json={"name": "S"})).json()
    await client.post(
        f"/api/series/{series['id']}/books/{book.id}", json={"sequence": 1}
    )
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "R", "series_id": series["id"]}
        )
    ).json()

    # Detail endpoint
    detail = (await client.get(f"/api/reading-orders/{ro['id']}")).json()
    assert detail["entries"][0]["title"] == "Embedded Title"
    assert detail["entries"][0]["format"] == "epub"

    # List endpoint
    orders = (await client.get(f"/api/series/{series['id']}/reading-orders")).json()
    assert orders[0]["entries"][0]["title"] == "Embedded Title"


async def test_reading_order_prepopulates_from_parent_series(client, db_session, tmp_path):
    """Reading order on a parent series collects books from all descendant series."""
    shelf = await _create_shelf(db_session, tmp_path)

    # Parent series
    parent = (await client.post("/api/series", json={"name": "Cosmere"})).json()

    # Child series A — Stormlight Archive
    sa = (
        await client.post("/api/series", json={"name": "Stormlight", "parent_id": parent["id"]})
    ).json()
    # Child series B — Mistborn
    mb = (
        await client.post("/api/series", json={"name": "Mistborn", "parent_id": parent["id"]})
    ).json()

    # Books in Stormlight (seq 1, 2)
    sa1 = await _create_book(db_session, shelf.id, "Way of Kings")
    sa2 = await _create_book(db_session, shelf.id, "Words of Radiance")
    await client.post(f"/api/series/{sa['id']}/books/{sa1.id}", json={"sequence": 1})
    await client.post(f"/api/series/{sa['id']}/books/{sa2.id}", json={"sequence": 2})

    # Books in Mistborn (seq 1, 2)
    mb1 = await _create_book(db_session, shelf.id, "Final Empire")
    mb2 = await _create_book(db_session, shelf.id, "Well of Ascension")
    await client.post(f"/api/series/{mb['id']}/books/{mb1.id}", json={"sequence": 1})
    await client.post(f"/api/series/{mb['id']}/books/{mb2.id}", json={"sequence": 2})

    # Create reading order on the parent — should get all 4 books
    ro = (
        await client.post(
            "/api/reading-orders", json={"name": "Full Cosmere", "series_id": parent["id"]}
        )
    ).json()

    detail = (await client.get(f"/api/reading-orders/{ro['id']}")).json()
    entries = sorted(detail["entries"], key=lambda e: e["position"])
    assert len(entries) == 4

    # First two entries are Stormlight (child series sorted before Mistborn alphabetically
    # by name: "Mistborn" < "Stormlight" — so Mistborn comes first)
    titles = [e["title"] for e in entries]
    # Both sub-series books should all be present
    assert "Way of Kings" in titles
    assert "Words of Radiance" in titles
    assert "Final Empire" in titles
    assert "Well of Ascension" in titles
    # Within each sub-series, sequence order is preserved
    mistborn_positions = {
        e["title"]: e["position"] for e in entries if e["title"] in ("Final Empire", "Well of Ascension")
    }
    assert mistborn_positions["Final Empire"] < mistborn_positions["Well of Ascension"]
    stormlight_positions = {
        e["title"]: e["position"] for e in entries if e["title"] in ("Way of Kings", "Words of Radiance")
    }
    assert stormlight_positions["Way of Kings"] < stormlight_positions["Words of Radiance"]
