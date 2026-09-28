"""Library health check and generated covers."""

from __future__ import annotations

import io
import uuid
import zipfile

import pytest
from PIL import Image
from sqlalchemy import select

from app.models.book import Book, BookHash
from app.models.series import BookSeries, Series
from app.models.shelf import Shelf
from app.services.cover_generator import (
    PALETTES,
    choose_style,
    format_sequence,
    render_cover,
)
from app.services.hash_service import koreader_partial_md5


def _epub(path, title="Book"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" '
            'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>",
        )
        z.writestr(
            "content.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
            'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:identifier id="id">x</dc:identifier><dc:title>{title}</dc:title>'
            "<dc:language>en</dc:language></metadata>"
            '<manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c"/></spine></package>',
        )
        z.writestr(
            "c.xhtml",
            '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Text</p></body></html>',
        )


async def _library(db_session, tmp_path):
    shelf = Shelf(name="Library", path=str(tmp_path))
    db_session.add(shelf)
    await db_session.flush()

    def book(title, file_path, **kw):
        b = Book(
            id=str(uuid.uuid4()),
            title=title,
            format=kw.pop("format", "epub"),
            file_path=file_path,
            shelf_id=shelf.id,
            **kw,
        )
        db_session.add(b)
        return b

    (tmp_path / "good.epub").write_bytes(b"")
    _epub(tmp_path / "good.epub")
    cover = tmp_path / "cover.jpg"
    Image.new("RGB", (10, 15)).save(cover)
    good = book(
        "Good",
        "good.epub",
        author="A",
        cover_path=str(cover),
        file_hash_md5_ko=koreader_partial_md5(tmp_path / "good.epub"),
    )
    _epub(tmp_path / "nocover.epub")
    nocover = book(
        "No Cover",
        "nocover.epub",
        author="A",
        file_hash="sha",
        file_hash_md5="md5",
        file_hash_md5_ko="x",
    )
    gone = book("Gone", "gone.epub", author="A", cover_path=str(cover), file_hash_md5_ko="y")
    (tmp_path / "broken.epub").write_bytes(b"not a zip")
    broken = book("Broken", "broken.epub", author="A", cover_path=str(cover))
    _epub(tmp_path / "nofp.epub")
    nofp = book("No Fingerprint", "nofp.epub", author=None, cover_path=str(cover))
    manual = book("Paper Book", "manual://paper", author="A", cover_path=str(cover))
    await db_session.commit()
    return {
        "good": good.id,
        "nocover": nocover.id,
        "gone": gone.id,
        "broken": broken.id,
        "nofp": nofp.id,
        "manual": manual.id,
    }


def _issues(report):
    return {i["key"]: {b["title"] for b in i["books"]} for i in report["issues"]}


@pytest.mark.asyncio
async def test_health_report_finds_each_problem(client, db_session, tmp_path):
    await _library(db_session, tmp_path)
    resp = await client.get("/api/library-health")
    assert resp.status_code == 200
    report = resp.json()
    assert report["total_books"] == 6
    issues = _issues(report)
    assert issues["missing_file"] == {"Gone"}
    assert issues["unreadable_file"] == {"Broken"}
    assert issues["no_cover"] == {"No Cover"}
    assert issues["no_fingerprint"] == {"No Fingerprint"}
    assert issues["no_author"] == {"No Fingerprint"}
    assert issues["generated_cover"] == set()
    broken = next(i for i in report["issues"] if i["key"] == "unreadable_file")
    assert "not a zip" in broken["books"][0]["detail"]
    assert {link["tab"] for link in report["links"]} == {"duplicate-books", "unmatched"}


@pytest.mark.asyncio
async def test_remove_missing_only_removes_books_whose_file_is_gone(client, db_session, tmp_path):
    ids = await _library(db_session, tmp_path)
    resp = await client.post(
        "/api/library-health/remove-missing",
        json={"book_ids": [ids["gone"], ids["good"], ids["manual"]]},
    )
    assert resp.json() == {"removed": 1}
    db_session.expire_all()
    remaining = set((await db_session.execute(select(Book.id))).scalars())
    assert ids["gone"] not in remaining
    assert {ids["good"], ids["manual"]} <= remaining


@pytest.mark.asyncio
async def test_record_missing_fingerprints(client, db_session, tmp_path):
    ids = await _library(db_session, tmp_path)
    resp = await client.post("/api/library-health/fingerprints")
    assert resp.json()["updated"] >= 1
    db_session.expire_all()
    book = await db_session.get(Book, ids["nofp"])
    assert book.file_hash_md5_ko == koreader_partial_md5(tmp_path / "nofp.epub")
    assert "no_fingerprint" not in {
        i["key"] for i in (await client.get("/api/library-health")).json()["issues"] if i["count"]
    }


# ── covers ────────────────────────────────────────────────────────────────────


def test_series_share_a_colour_and_numbers_are_padded():
    a, _ = choose_style("The Way of Kings", "Brandon Sanderson", "The Stormlight Archive")
    b, _ = choose_style("Oathbringer", "Brandon Sanderson", "The Stormlight Archive")
    assert a == b
    assert a in PALETTES
    assert format_sequence(3) == "03"
    assert format_sequence(12.0) == "12"
    assert format_sequence(2.5) == "2.5"
    assert format_sequence(None) is None


def test_render_is_deterministic_and_handles_long_titles():
    one = render_cover("Dune", "Frank Herbert")
    assert one.size == (800, 1200)
    assert one.tobytes() == render_cover("Dune", "Frank Herbert").tobytes()
    long = render_cover("word " * 80, None, "A Very Long Series Name " * 5, 123.5)
    assert long.size == (800, 1200)
    render_cover("", None)  # untitled still renders


@pytest.mark.asyncio
async def test_preview_and_generate_a_cover(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setenv("SHELFLOOM_COVERS_DIR", str(tmp_path / "covers"))
    ids = await _library(db_session, tmp_path)
    series = Series(name="The Series")
    db_session.add(series)
    await db_session.flush()
    db_session.add(BookSeries(book_id=ids["nocover"], series_id=series.id, sequence=2))
    await db_session.commit()

    preview = await client.get(f"/api/books/{ids['nocover']}/generated-cover")
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(preview.content)).size == (800, 1200)
    assert (await client.get("/api/books/nope/generated-cover")).status_code == 404

    old_digest = (await db_session.get(Book, ids["nocover"])).file_hash_md5_ko
    resp = await client.post(f"/api/books/{ids['nocover']}/generate-cover", json={"embed": True})
    assert resp.status_code == 200
    assert resp.json()["cover_path"].endswith("-generated.jpg")

    # It's served as the book's cover, written into the EPUB, and the old
    # KOReader fingerprint is kept for sync.
    assert (await client.get(f"/api/books/{ids['nocover']}/cover")).status_code == 200
    with zipfile.ZipFile(tmp_path / "nocover.epub") as z:
        assert any(n.lower().endswith((".jpg", ".jpeg")) for n in z.namelist())
    db_session.expire_all()
    hashes = (
        await db_session.execute(
            select(BookHash.hash_md5_ko).where(BookHash.book_id == ids["nocover"])
        )
    ).scalars()
    assert old_digest in set(hashes)

    report = (await client.get("/api/library-health")).json()
    issues = _issues(report)
    assert "No Cover" not in issues["no_cover"]
    assert issues["generated_cover"] == {"No Cover"}


@pytest.mark.asyncio
async def test_generate_covers_for_every_book_without_one(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setenv("SHELFLOOM_COVERS_DIR", str(tmp_path / "covers"))
    ids = await _library(db_session, tmp_path)
    resp = await client.post("/api/library-health/generate-covers", json={"embed": False})
    assert resp.json() == {"generated": 1, "failed": 0}
    with zipfile.ZipFile(tmp_path / "nocover.epub") as z:  # embed off: file untouched
        assert not any(n.lower().endswith(".jpg") for n in z.namelist())
    db_session.expire_all()
    assert (await db_session.get(Book, ids["nocover"])).cover_path.endswith("-generated.jpg")
