"""Tests for bulk book action endpoints."""

import uuid

from app.models.book import Book
from app.models.genre import Genre
from app.models.shelf import Shelf
from app.models.tag import Tag

# ── helpers ───────────────────────────────────────────────────────────────────


async def _create_shelf(db_session, tmp_path, name="Shelf", is_default=False) -> Shelf:
    shelf = Shelf(name=name, path=str(tmp_path), is_default=is_default)
    db_session.add(shelf)
    await db_session.commit()
    await db_session.refresh(shelf)
    return shelf


async def _create_book(db_session, shelf_id: int, title="Book", author="A") -> Book:
    book = Book(
        id=str(uuid.uuid4()),
        title=title,
        author=author,
        format="epub",
        file_path=f"{title}.epub",
        shelf_id=shelf_id,
    )
    db_session.add(book)
    await db_session.commit()
    await db_session.refresh(book)
    return book


async def _create_tag(db_session, name: str) -> Tag:
    tag = Tag(name=name)
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)
    return tag


async def _create_genre(db_session, name: str) -> Genre:
    genre = Genre(name=name)
    db_session.add(genre)
    await db_session.commit()
    await db_session.refresh(genre)
    return genre


# ── bulk metadata ─────────────────────────────────────────────────────────────


async def test_bulk_metadata_add_tags_and_genres(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")
    b2 = await _create_book(db_session, shelf.id, "Book 2")
    tag = await _create_tag(db_session, "sci-fi")
    genre = await _create_genre(db_session, "Fantasy")

    resp = await client.post(
        "/api/books/bulk-metadata",
        json={
            "book_ids": [b1.id, b2.id],
            "add_tag_ids": [tag.id],
            "add_genre_ids": [genre.id],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert data["succeeded"] == 2
    assert data["failed"] == 0

    # Verify tags/genres are actually assigned
    for book_id in [b1.id, b2.id]:
        book_resp = await client.get(f"/api/books/{book_id}")
        book_data = book_resp.json()
        assert any(t["id"] == tag.id for t in book_data["tags"])
        assert any(g["id"] == genre.id for g in book_data["genres"])


async def test_bulk_metadata_remove_tags(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")
    b2 = await _create_book(db_session, shelf.id, "Book 2")
    tag = await _create_tag(db_session, "to-remove")

    # First, assign the tag
    await client.post(f"/api/books/{b1.id}/tags/{tag.id}")
    await client.post(f"/api/books/{b2.id}/tags/{tag.id}")

    # Bulk remove
    resp = await client.post(
        "/api/books/bulk-metadata",
        json={
            "book_ids": [b1.id, b2.id],
            "remove_tag_ids": [tag.id],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["succeeded"] == 2

    # Verify removed
    for book_id in [b1.id, b2.id]:
        book_resp = await client.get(f"/api/books/{book_id}")
        book_data = book_resp.json()
        assert not any(t["id"] == tag.id for t in book_data["tags"])


async def test_bulk_metadata_partial_failure(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")
    tag = await _create_tag(db_session, "valid-tag")

    resp = await client.post(
        "/api/books/bulk-metadata",
        json={
            "book_ids": [b1.id, "nonexistent-book-id"],
            "add_tag_ids": [tag.id],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert data["succeeded"] == 1
    assert data["failed"] == 1

    # The real book should still succeed
    results_by_id = {r["book_id"]: r for r in data["results"]}
    assert results_by_id[b1.id]["success"] is True
    assert results_by_id["nonexistent-book-id"]["success"] is False
    assert results_by_id["nonexistent-book-id"]["error"] is not None


async def test_bulk_metadata_idempotent(client, db_session, tmp_path):
    """Assigning an already-assigned tag/genre is a no-op, not an error."""
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")
    tag = await _create_tag(db_session, "dup-tag")

    # Assign once
    await client.post(f"/api/books/{b1.id}/tags/{tag.id}")

    # Bulk add again
    resp = await client.post(
        "/api/books/bulk-metadata",
        json={"book_ids": [b1.id], "add_tag_ids": [tag.id]},
    )
    assert resp.status_code == 200
    assert resp.json()["succeeded"] == 1


async def test_bulk_metadata_remove_unassigned_is_noop(client, db_session, tmp_path):
    """Removing a tag/genre that isn't assigned should not fail."""
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")
    tag = await _create_tag(db_session, "not-assigned")

    resp = await client.post(
        "/api/books/bulk-metadata",
        json={"book_ids": [b1.id], "remove_tag_ids": [tag.id]},
    )
    assert resp.status_code == 200
    assert resp.json()["succeeded"] == 1


async def test_bulk_metadata_empty_book_ids(client):
    resp = await client.post(
        "/api/books/bulk-metadata",
        json={"book_ids": [], "add_tag_ids": [1]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["succeeded"] == 0


# ── bulk move ─────────────────────────────────────────────────────────────────


async def test_bulk_move_success(client, db_session, tmp_path):
    src_dir = tmp_path / "src"
    dst_dir = tmp_path / "dst"
    src_dir.mkdir()
    dst_dir.mkdir()

    shelf_src = await _create_shelf(db_session, src_dir, "Source")
    shelf_dst = await _create_shelf(db_session, dst_dir, "Dest")

    # Create actual files on disk
    (src_dir / "A.epub").write_bytes(b"epub-a")
    (src_dir / "B.epub").write_bytes(b"epub-b")

    b1 = await _create_book(db_session, shelf_src.id, "A")
    b2 = await _create_book(db_session, shelf_src.id, "B")

    resp = await client.post(
        "/api/books/bulk-move",
        json={"book_ids": [b1.id, b2.id], "target_shelf_id": shelf_dst.id},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["succeeded"] == 2
    assert data["failed"] == 0

    # Verify books are now on the destination shelf
    for book_id in [b1.id, b2.id]:
        book_resp = await client.get(f"/api/books/{book_id}")
        assert book_resp.json()["shelf_id"] == shelf_dst.id


async def test_bulk_move_partial_failure(client, db_session, tmp_path):
    src_dir = tmp_path / "src"
    dst_dir = tmp_path / "dst"
    src_dir.mkdir()
    dst_dir.mkdir()

    shelf_src = await _create_shelf(db_session, src_dir, "Source")
    shelf_dst = await _create_shelf(db_session, dst_dir, "Dest")

    (src_dir / "A.epub").write_bytes(b"epub-a")
    b1 = await _create_book(db_session, shelf_src.id, "A")

    resp = await client.post(
        "/api/books/bulk-move",
        json={
            "book_ids": [b1.id, "nonexistent-id"],
            "target_shelf_id": shelf_dst.id,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["succeeded"] == 1
    assert data["failed"] == 1


async def test_bulk_move_invalid_shelf(client, db_session, tmp_path):
    shelf = await _create_shelf(db_session, tmp_path)
    b1 = await _create_book(db_session, shelf.id, "Book 1")

    resp = await client.post(
        "/api/books/bulk-move",
        json={"book_ids": [b1.id], "target_shelf_id": 9999},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["failed"] == 1
    assert "not found" in data["results"][0]["error"].lower()
