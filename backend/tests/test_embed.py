"""Tests for Shelfloom ID embedding into EPUB files."""

import uuid
from pathlib import Path

import pytest
from ebooklib import epub

FIXTURES = Path(__file__).parent / "fixtures"


def _make_epub(
    tmp_path: Path, name: str = "book.epub", with_shelfloom_id: str | None = None
) -> Path:
    """Create a minimal valid EPUB and return its path."""
    book = epub.EpubBook()
    book.set_identifier("pub-id-001")
    book.set_title("Embed Test Book")
    book.add_author("Test Author")
    if with_shelfloom_id:
        book.add_metadata(
            "DC",
            "identifier",
            f"urn:shelfloom:{with_shelfloom_id}",
            {"id": "shelfloom-id"},
        )
    c1 = epub.EpubHtml(title="C1", file_name="c1.xhtml")
    c1.content = "<p>content</p>"
    book.add_item(c1)
    book.spine = ["nav", c1]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / name
    epub.write_epub(str(path), book)
    return path


# ── basic embedding ───────────────────────────────────────────────────────────


async def test_embed_adds_shelfloom_id(tmp_path):
    from app.services.metadata.embed import embed_shelfloom_id
    from app.services.metadata.epub import parse_epub

    path = _make_epub(tmp_path)
    book_uuid, pre_sha, pre_md5, post_sha, post_md5 = embed_shelfloom_id(path)

    # ID should now be readable
    meta = parse_epub(path)
    assert meta.shelfloom_id == book_uuid


async def test_embed_hash_changes(tmp_path):
    from app.services.metadata.embed import embed_shelfloom_id

    path = _make_epub(tmp_path)
    _, pre_sha, pre_md5, post_sha, post_md5 = embed_shelfloom_id(path)

    assert pre_sha != post_sha
    assert pre_md5 != post_md5


async def test_embed_returns_correct_pre_hash(tmp_path):
    import hashlib

    from app.services.metadata.embed import embed_shelfloom_id

    path = _make_epub(tmp_path)
    original_bytes = path.read_bytes()
    expected_sha = hashlib.sha256(original_bytes).hexdigest()
    expected_md5 = hashlib.md5(original_bytes).hexdigest()

    _, pre_sha, pre_md5, _, _ = embed_shelfloom_id(path)
    assert pre_sha == expected_sha
    assert pre_md5 == expected_md5


async def test_embed_post_hash_matches_disk(tmp_path):
    import hashlib

    from app.services.metadata.embed import embed_shelfloom_id

    path = _make_epub(tmp_path)
    _, _, _, post_sha, post_md5 = embed_shelfloom_id(path)

    disk_bytes = path.read_bytes()
    assert hashlib.sha256(disk_bytes).hexdigest() == post_sha
    assert hashlib.md5(disk_bytes).hexdigest() == post_md5


async def test_embed_with_specified_uuid(tmp_path):
    from app.services.metadata.embed import embed_shelfloom_id
    from app.services.metadata.epub import parse_epub

    path = _make_epub(tmp_path)
    my_uuid = str(uuid.uuid4())
    returned_uuid, *_ = embed_shelfloom_id(path, book_uuid=my_uuid)

    assert returned_uuid == my_uuid
    meta = parse_epub(path)
    assert meta.shelfloom_id == my_uuid


# ── idempotency ───────────────────────────────────────────────────────────────


async def test_embed_idempotent_already_has_id(tmp_path):
    """If EPUB already has a Shelfloom ID, embedding is a no-op."""
    from app.services.metadata.embed import embed_shelfloom_id

    existing_uuid = str(uuid.uuid4())
    path = _make_epub(tmp_path, with_shelfloom_id=existing_uuid)

    original_bytes = path.read_bytes()
    returned_uuid, pre_sha, pre_md5, post_sha, post_md5 = embed_shelfloom_id(path)

    # Same UUID returned
    assert returned_uuid == existing_uuid
    # File unchanged — same hash
    assert pre_sha == post_sha
    assert pre_md5 == post_md5
    assert path.read_bytes() == original_bytes


async def test_embed_idempotent_double_embed(tmp_path):
    """Embedding twice produces the same result as embedding once."""
    from app.services.metadata.embed import embed_shelfloom_id

    path = _make_epub(tmp_path)
    uuid1, _, _, sha1, _ = embed_shelfloom_id(path)
    uuid2, _, _, sha2, _ = embed_shelfloom_id(path)

    assert uuid1 == uuid2
    assert sha1 == sha2


# ── original metadata preserved ──────────────────────────────────────────────


async def test_embed_preserves_existing_identifiers(tmp_path):
    """Original dc:identifier elements remain after embedding."""
    from app.services.metadata.embed import embed_shelfloom_id
    from app.services.metadata.epub import parse_epub

    path = _make_epub(tmp_path)
    embed_shelfloom_id(path)

    meta = parse_epub(path)
    # The original "pub-id-001" identifier should survive
    assert meta.epub_uid == "pub-id-001"


async def test_embed_epub_still_parseable(tmp_path):
    """EPUB remains valid after embedding."""
    from app.services.metadata.embed import embed_shelfloom_id
    from app.services.metadata.epub import parse_epub

    path = _make_epub(tmp_path)
    embed_shelfloom_id(path)

    meta = parse_epub(path)
    assert meta.title == "Embed Test Book"
    assert meta.author == "Test Author"


# ── error cases ───────────────────────────────────────────────────────────────


async def test_embed_file_not_found(tmp_path):
    from app.services.metadata.embed import EmbedError, embed_shelfloom_id

    with pytest.raises(EmbedError, match="File not found"):
        embed_shelfloom_id(tmp_path / "nonexistent.epub")


async def test_embed_bad_zip(tmp_path):
    from app.services.metadata.embed import EmbedError, embed_shelfloom_id

    bad = tmp_path / "bad.epub"
    bad.write_bytes(b"this is not a zip file")
    with pytest.raises(EmbedError):
        embed_shelfloom_id(bad)
