"""Tests for the KOSync server.

Requests mirror what KOReader's built-in Progress sync plugin sends
(koreader/plugins/kosync.koplugin: KOSyncClient.lua and api.json):
x-auth-user / x-auth-key headers where the key is md5(password), POST to
register, the document in the path when pulling, and percentages of 0–1.
"""

from __future__ import annotations

import base64
import hashlib
import uuid

import pytest
from sqlalchemy import select

from app.models.book import Book, BookHash
from app.models.kosync import KoSyncUser
from app.models.reading import ReadingProgress
from app.models.shelf import Shelf

KO_HEADERS = {"accept": "application/vnd.koreader.v1+json"}


def _key(password: str) -> str:
    return hashlib.md5(password.encode()).hexdigest()


def _ko_auth(username: str, password: str) -> dict:
    return {**KO_HEADERS, "x-auth-user": username, "x-auth-key": _key(password)}


def _basic_auth(username: str, password: str) -> dict:
    creds = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {creds}"}


async def _register(client, username="reader", password="secret"):
    resp = await client.post(
        "/api/kosync/users/create",
        json={"username": username, "password": _key(password)},
        headers=KO_HEADERS,
    )
    assert resp.status_code == 201
    return _ko_auth(username, password)


def _progress(document="doc1", percentage=0.5, device="Kindle", device_id="KINDLE-1", **kw):
    return {
        "document": document,
        "progress": kw.get("progress", "/body/DocFragment[10]/body/p[3]/text().0"),
        "percentage": percentage,
        "device": device,
        "device_id": device_id,
    }


# ── users ─────────────────────────────────────────────────────────────────────


async def test_register_like_koreader(client):
    resp = await client.post(
        "/api/kosync/users/create",
        json={"username": "alice", "password": _key("pw")},
        headers=KO_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json() == {"username": "alice"}


async def test_register_duplicate_is_402_like_the_reference_server(client):
    await _register(client, "bob")
    resp = await client.post(
        "/api/kosync/users/create", json={"username": "bob", "password": _key("other")}
    )
    assert resp.status_code == 402
    assert resp.json()["code"] == 2002


async def test_legacy_put_registration_still_works(client):
    resp = await client.put(
        "/api/kosync/users/create", json={"username": "carol", "password": "mypass"}
    )
    assert resp.status_code == 201
    # A plain password registered this way works from KOReader too.
    auth = await client.get("/api/kosync/users/auth", headers=_ko_auth("carol", "mypass"))
    assert auth.status_code == 200


async def test_auth_with_koreader_headers(client):
    headers = await _register(client, "dave", "rightpass")
    resp = await client.get("/api/kosync/users/auth", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["authorized"] == "OK"

    wrong = await client.get("/api/kosync/users/auth", headers=_ko_auth("dave", "nope"))
    assert wrong.status_code == 401
    assert wrong.json() == {"code": 2001, "message": "Unauthorized"}
    unknown = await client.get("/api/kosync/users/auth", headers=_ko_auth("nobody", "x"))
    assert unknown.status_code == 401
    assert (await client.get("/api/kosync/users/auth")).status_code == 401


async def test_basic_auth_accepted_and_legacy_accounts_upgraded(client, db_session):
    # An account stored the old way: sha256 of the plain password.
    db_session.add(KoSyncUser(username="old", password_hash=hashlib.sha256(b"legacy").hexdigest()))
    await db_session.commit()

    assert (
        await client.get("/api/kosync/users/auth", headers=_ko_auth("old", "legacy"))
    ).status_code == 401  # KOReader can't use it yet…
    assert (
        await client.get("/api/kosync/users/auth", headers=_basic_auth("old", "legacy"))
    ).status_code == 200  # …until one Basic-auth login upgrades it.
    assert (
        await client.get("/api/kosync/users/auth", headers=_ko_auth("old", "legacy"))
    ).status_code == 200
    assert (
        await client.get("/api/kosync/users/auth", headers=_basic_auth("old", "wrong"))
    ).status_code == 401


# ── progress ──────────────────────────────────────────────────────────────────


async def test_push_and_pull_like_koreader(client):
    headers = await _register(client)
    put = await client.put(
        "/api/kosync/syncs/progress", json=_progress(percentage=0.455), headers=headers
    )
    assert put.status_code == 200
    assert put.json()["document"] == "doc1"
    assert isinstance(put.json()["timestamp"], int)

    pull = await client.get("/api/kosync/syncs/progress/doc1", headers=headers)
    assert pull.status_code == 200
    body = pull.json()
    assert body["percentage"] == pytest.approx(0.455)
    assert body["progress"] == "/body/DocFragment[10]/body/p[3]/text().0"
    assert body["device"] == "Kindle"
    # KOReader compares device_id to skip its own record.
    assert body["device_id"] == "KINDLE-1"

    # The older query-string form still answers.
    legacy = await client.get(
        "/api/kosync/syncs/progress", params={"document": "doc1"}, headers=headers
    )
    assert legacy.json()["percentage"] == pytest.approx(0.455)


async def test_unknown_document_is_an_empty_object(client):
    headers = await _register(client)
    resp = await client.get("/api/kosync/syncs/progress/unknown", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {}


async def test_progress_requires_auth(client):
    await _register(client)
    assert (
        await client.put("/api/kosync/syncs/progress", json=_progress(), headers=KO_HEADERS)
    ).status_code == 401
    assert (
        await client.get("/api/kosync/syncs/progress/doc1", headers=_ko_auth("reader", "bad"))
    ).status_code == 401


async def test_newest_position_wins_not_the_furthest(client):
    headers = await _register(client)
    await client.put(
        "/api/kosync/syncs/progress",
        json=_progress(percentage=0.8, device="Kindle", device_id="K"),
        headers=headers,
    )
    # Later, on another device, the reader goes back to re-read a chapter.
    await client.put(
        "/api/kosync/syncs/progress",
        json=_progress(percentage=0.3, device="Phone", device_id="P"),
        headers=headers,
    )
    body = (await client.get("/api/kosync/syncs/progress/doc1", headers=headers)).json()
    assert (body["device"], body["percentage"]) == ("Phone", pytest.approx(0.3))


async def test_percentage_over_one_is_treated_as_a_percent(client):
    headers = await _register(client)
    await client.put("/api/kosync/syncs/progress", json=_progress(percentage=60), headers=headers)
    body = (await client.get("/api/kosync/syncs/progress/doc1", headers=headers)).json()
    assert body["percentage"] == pytest.approx(0.6)


async def test_users_do_not_see_each_others_progress(client):
    alice = await _register(client, "alice", "a")
    bob = await _register(client, "bob", "b")
    await client.put("/api/kosync/syncs/progress", json=_progress(), headers=alice)
    assert (await client.get("/api/kosync/syncs/progress/doc1", headers=bob)).json() == {}


async def test_repeat_push_from_a_device_updates_its_record(client):
    headers = await _register(client)
    for pct in (0.1, 0.2, 0.6):
        await client.put(
            "/api/kosync/syncs/progress", json=_progress(percentage=pct), headers=headers
        )
    body = (await client.get("/api/kosync/syncs/progress/doc1", headers=headers)).json()
    assert body["percentage"] == pytest.approx(0.6)


# ── linking to library books ──────────────────────────────────────────────────


async def _book(db_session, tmp_path, *, ko_hash: str, old_hashes: tuple[str, ...] = ()):
    shelf = Shelf(name=f"Shelf {uuid.uuid4().hex[:4]}", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.flush()
    book = Book(
        id=str(uuid.uuid4()),
        title="The Book",
        format="epub",
        file_path="Author/The Book.epub",
        shelf_id=shelf.id,
        file_hash_md5_ko=ko_hash,
    )
    db_session.add(book)
    await db_session.flush()
    for h in old_hashes:
        db_session.add(BookHash(book_id=book.id, hash_sha="s", hash_md5="m", hash_md5_ko=h))
    await db_session.commit()
    return book.id


async def test_positions_follow_the_book_across_file_changes(client, db_session, tmp_path):
    book_id = await _book(db_session, tmp_path, ko_hash="new" * 10 + "aa", old_hashes=("old1",))
    headers = await _register(client)
    # The Kindle still sends the digest it cached before the file changed.
    await client.put(
        "/api/kosync/syncs/progress",
        json=_progress(document="old1", percentage=0.4),
        headers=headers,
    )
    # A device holding the new file sees that position…
    body = (
        await client.get(f"/api/kosync/syncs/progress/{'new' * 10 + 'aa'}", headers=headers)
    ).json()
    assert body["percentage"] == pytest.approx(0.4)
    assert body["document"] == "new" * 10 + "aa"

    # …and the book page shows it.
    rows = (
        (
            await db_session.execute(
                select(ReadingProgress).where(ReadingProgress.book_id == book_id)
            )
        )
        .scalars()
        .all()
    )
    assert [(r.device, r.progress) for r in rows] == [("Kindle", 40.0)]


async def test_filename_digest_matching(client, db_session, tmp_path):
    await _book(db_session, tmp_path, ko_hash="abc")
    headers = await _register(client)
    name_digest = hashlib.md5(b"The Book.epub").hexdigest()
    await client.put(
        "/api/kosync/syncs/progress",
        json=_progress(document=name_digest, percentage=0.25),
        headers=headers,
    )
    # Pulled by the binary digest, the filename-matched position is found.
    body = (await client.get("/api/kosync/syncs/progress/abc", headers=headers)).json()
    assert body["percentage"] == pytest.approx(0.25)


# ── web reader ────────────────────────────────────────────────────────────────


async def test_web_reader_and_koreader_share_one_position(client, db_session, tmp_path):
    book_id = await _book(db_session, tmp_path, ko_hash="bookdigest")
    headers = await _register(client)
    assert (await client.get(f"/api/books/{book_id}/position")).json() is None

    # Read in the browser…
    resp = await client.put(
        f"/api/books/{book_id}/position",
        json={
            "progress": "/body/DocFragment[4]/body/p[2]/text().10",
            "percentage": 0.2,
            "locator": "epubcfi(/6/8!/4/4,/1:10)",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["device"] == "Shelfloom Web"

    # …then KOReader opens the book and pulls it.
    pulled = (await client.get("/api/kosync/syncs/progress/bookdigest", headers=headers)).json()
    assert pulled["progress"] == "/body/DocFragment[4]/body/p[2]/text().10"
    assert pulled["device_id"] == "shelfloom-web"

    # The web reader resumes exactly where it was (its own locator).
    pos = (await client.get(f"/api/books/{book_id}/position")).json()
    assert pos["from_web_reader"] is True
    assert pos["locator"] == "epubcfi(/6/8!/4/4,/1:10)"

    # Reading on the Kindle later wins; the web reader gets the XPointer to convert.
    await client.put(
        "/api/kosync/syncs/progress",
        json=_progress(document="bookdigest", percentage=0.35),
        headers=headers,
    )
    pos = (await client.get(f"/api/books/{book_id}/position")).json()
    assert pos["from_web_reader"] is False
    assert pos["locator"] is None
    assert pos["percentage"] == pytest.approx(0.35)
    assert pos["progress"].startswith("/body/DocFragment[10]")


async def test_web_position_validation(client, db_session, tmp_path):
    book_id = await _book(db_session, tmp_path, ko_hash="d")
    bad = await client.put(
        f"/api/books/{book_id}/position", json={"progress": "x", "percentage": 2}
    )
    assert bad.status_code == 422
    missing = await client.put(
        "/api/books/nope/position", json={"progress": "x", "percentage": 0.1}
    )
    assert missing.status_code == 404


async def test_web_session_is_extended_not_duplicated(client, db_session, tmp_path):
    book_id = await _book(db_session, tmp_path, ko_hash="d")
    start = "2026-09-28T10:00:00Z"
    for minutes in (1, 5, 12):
        resp = await client.put(
            f"/api/books/{book_id}/web-session",
            json={"start_time": start, "duration": minutes * 60, "pages_read": minutes},
        )
        assert resp.status_code == 200
    sessions = (await client.get(f"/api/books/{book_id}/sessions")).json()["items"]
    assert [(s["duration"], s["source"], s["device"]) for s in sessions] == [
        (720, "web", "Shelfloom Web")
    ]
    summary = (await client.get(f"/api/books/{book_id}/reading-summary")).json()
    assert summary["total_time_seconds"] == 720


# ── accounts from the settings page ───────────────────────────────────────────


async def test_manage_accounts_from_settings(client, db_session, tmp_path):
    book_id = await _book(db_session, tmp_path, ko_hash="d1")
    resp = await client.post("/api/sync-accounts", json={"username": "kindle", "password": "pw"})
    assert resp.status_code == 201
    assert (
        await client.post("/api/sync-accounts", json={"username": "kindle", "password": "x"})
    ).status_code == 409

    # The password set here is what KOReader signs in with.
    headers = _ko_auth("kindle", "pw")
    assert (await client.get("/api/kosync/users/auth", headers=headers)).status_code == 200
    await client.put("/api/kosync/syncs/progress", json=_progress(document="d1"), headers=headers)
    accounts = (await client.get("/api/sync-accounts")).json()
    assert accounts[0]["username"] == "kindle"
    assert accounts[0]["last_device"] == "Kindle"
    assert accounts[0]["last_book_title"] == "The Book"
    assert accounts[0]["last_synced_at"] > 0
    assert book_id

    assert (await client.delete("/api/sync-accounts/kindle")).status_code == 204
    assert (await client.delete("/api/sync-accounts/kindle")).status_code == 404
    assert (await client.get("/api/kosync/users/auth", headers=headers)).status_code == 401
