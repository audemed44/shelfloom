"""Tests for the authors endpoint."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_list_authors_empty(client):
    resp = await client.get("/api/authors")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_authors(client, shelf_factory, book_factory):
    shelf = await shelf_factory()
    await book_factory(title="Book A", author="Alice", shelf_id=shelf.id, file_path="a.epub")
    await book_factory(title="Book B", author="Bob", shelf_id=shelf.id, file_path="b.epub")
    await book_factory(title="Book C", author="Alice", shelf_id=shelf.id, file_path="c.epub")
    await book_factory(title="Book D", author=None, shelf_id=shelf.id, file_path="d.epub")

    resp = await client.get("/api/authors")
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert names == ["Alice", "Bob"]  # sorted, deduplicated, no nulls
