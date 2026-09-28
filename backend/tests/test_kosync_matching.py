"""KOReader documents get linked to library books even when the digest
wasn't known when the position was synced."""

from __future__ import annotations

import hashlib

import pytest
from sqlalchemy import select

from app.koreader.sdr_importer import import_sdr
from app.koreader.sdr_reader import SdrReadingData
from app.models.book import Book, BookHash
from app.models.kosync import KoSyncProgress
from app.models.reading import ReadingProgress
from app.services.hash_service import koreader_partial_md5

KO = {"accept": "application/vnd.koreader.v1+json"}


async def _account(client, username="kindle", password="pw"):
    key = hashlib.md5(password.encode()).hexdigest()
    await client.post("/api/kosync/users/create", json={"username": username, "password": key})
    return {**KO, "x-auth-user": username, "x-auth-key": key}


async def _push(client, headers, document, percentage=0.4):
    resp = await client.put(
        "/api/kosync/syncs/progress",
        json={
            "document": document,
            "progress": "/body/DocFragment[4]/body/p[2]/text().0",
            "percentage": percentage,
            "device": "KindlePaperWhite5",
            "device_id": "PW5",
        },
        headers=headers,
    )
    assert resp.status_code == 200


def _sdr(digest: str) -> SdrReadingData:
    return SdrReadingData(
        partial_md5=digest,
        doc_path=None,
        title=None,
        authors=None,
        percent_finished=None,
        last_xpointer=None,
        doc_pages=None,
        status=None,
        performance_in_pages={},
        total_time_in_sec=None,
        annotations=[],
        raw={},
    )


@pytest.mark.asyncio
async def test_a_book_without_a_fingerprint_is_matched_when_it_syncs(
    client, db_session, shelf_factory, book_factory, tmp_path
):
    """Books imported before their KOReader digest was recorded still match:
    the digest is computed the first time an unknown document syncs."""
    shelf = await shelf_factory(path=str(tmp_path))
    (tmp_path / "isekai.epub").write_bytes(b"PK" + bytes(range(256)) * 400)
    book = await book_factory(title="Isekai Warbound", shelf_id=shelf.id, file_path="isekai.epub")
    book_id = book.id
    assert book.file_hash_md5_ko is None
    digest = koreader_partial_md5(tmp_path / "isekai.epub")

    headers = await _account(client)
    await _push(client, headers, digest)

    db_session.expire_all()
    assert (await db_session.get(Book, book_id)).file_hash_md5_ko == digest
    record = await db_session.scalar(select(KoSyncProgress))
    assert record.book_id == book_id
    accounts = (await client.get("/api/sync-accounts")).json()
    assert accounts[0]["last_book_title"] == "Isekai Warbound"


@pytest.mark.asyncio
async def test_positions_synced_before_the_book_matched_are_linked_later(
    client, db_session, shelf_factory, book_factory
):
    shelf = await shelf_factory()
    book = await book_factory(title="Mistborn", shelf_id=shelf.id)
    book_id = book.id
    headers = await _account(client)
    await _push(client, headers, "d" * 32)
    accounts = (await client.get("/api/sync-accounts")).json()
    assert accounts[0]["last_book_title"] is None

    # The digest becomes known (e.g. from the file's history).
    db_session.add(BookHash(book_id=book_id, hash_sha="s", hash_md5="m", hash_md5_ko="d" * 32))
    await db_session.commit()

    accounts = (await client.get("/api/sync-accounts")).json()
    assert accounts[0]["last_book_title"] == "Mistborn"
    db_session.expire_all()
    record = await db_session.scalar(select(KoSyncProgress))
    assert record.book_id == book_id
    progress = await db_session.scalar(
        select(ReadingProgress).where(ReadingProgress.book_id == book_id)
    )
    assert progress is not None and progress.progress == 40.0


@pytest.mark.asyncio
async def test_sdr_import_links_positions_and_keeps_the_digest(
    client, db_session, shelf_factory, book_factory
):
    shelf = await shelf_factory()
    book = await book_factory(title="Words of Radiance", shelf_id=shelf.id)
    book.file_hash, book.file_hash_md5, book.file_hash_md5_ko = "sha1", "md51", "computed"
    await db_session.commit()
    headers = await _account(client)
    await _push(client, headers, "e" * 32)

    await import_sdr(db_session, book, _sdr("e" * 32))
    await db_session.commit()

    record = await db_session.scalar(select(KoSyncProgress))
    assert record.book_id == book.id
    digests = set(
        (
            await db_session.execute(
                select(BookHash.hash_md5_ko).where(BookHash.book_id == book.id)
            )
        ).scalars()
    )
    # Both the digest KOReader uses and the one it replaced stay matchable.
    assert {"e" * 32, "computed"} <= digests
