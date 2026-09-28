"""Writing a cover into an EPUB changes only the cover, and never half-writes."""

from __future__ import annotations

import zipfile

import pytest
from ebooklib import epub
from PIL import Image

from app.services.metadata.cover import (
    CoverExtractionError,
    embed_epub_cover,
    extract_epub_cover,
)

OPF3 = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">x</dc:identifier><dc:title>T</dc:title>
    <meta name="cover" content="old-cover"/>
  </metadata>
  <manifest>
    <item id="old-cover" href="img/old.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c"/></spine>
</package>"""


def _jpeg(path, colour):
    Image.new("RGB", (60, 90), colour).save(path, "JPEG")
    return path


def _handmade(path, opf=OPF3):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" '
            'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/c.xhtml", "<html><body><p>Hi</p></body></html>")
        z.writestr(
            "OEBPS/nav.xhtml",
            '<html xmlns="http://www.w3.org/1999/xhtml" '
            'xmlns:epub="http://www.idpf.org/2007/ops"><body>'
            '<nav epub:type="toc"><ol><li><a href="c.xhtml">One</a></li></ol></nav>'
            "</body></html>",
        )
        z.writestr("OEBPS/img/old.png", b"\x89PNG old")
    return path


def test_replaces_the_cover_and_leaves_everything_else(tmp_path):
    book = _handmade(tmp_path / "b.epub")
    before = {i.filename: zipfile.ZipFile(book).read(i) for i in zipfile.ZipFile(book).infolist()}
    embed_epub_cover(book, _jpeg(tmp_path / "new.jpg", "red"))

    with zipfile.ZipFile(book) as z:
        assert z.namelist()[0] == "mimetype"
        assert z.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        opf = z.read("OEBPS/content.opf").decode()
        for name, data in before.items():
            if name != "OEBPS/content.opf":
                assert z.read(name) == data, name  # untouched, byte for byte
        assert z.read("OEBPS/shelfloom-cover.jpg")[:2] == b"\xff\xd8"
    # One cover everywhere: EPUB 3 property moved, EPUB 2 meta repointed.
    assert opf.count("cover-image") == 1
    assert 'id="shelfloom-cover"' in opf and 'properties="cover-image"' in opf
    assert '<meta name="cover" content="shelfloom-cover"/>' in opf
    assert 'id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"' in opf

    out = tmp_path / "extracted.jpg"
    assert extract_epub_cover(book, out)
    assert Image.open(out).getpixel((30, 45))[0] > 200  # the red one


def test_embedding_again_replaces_our_own_cover(tmp_path):
    book = _handmade(tmp_path / "b.epub")
    embed_epub_cover(book, _jpeg(tmp_path / "1.jpg", "red"))
    embed_epub_cover(book, _jpeg(tmp_path / "2.jpg", "blue"))
    with zipfile.ZipFile(book) as z:
        assert z.namelist().count("OEBPS/shelfloom-cover.jpg") == 1
        assert z.read("OEBPS/content.opf").decode().count('id="shelfloom-cover"') == 1
    out = tmp_path / "x.jpg"
    extract_epub_cover(book, out)
    assert Image.open(out).getpixel((30, 45))[2] > 200  # blue


def test_epub_made_by_ebooklib(tmp_path):
    """These books have nav and NCX documents; the old round-trip corrupted them."""
    b = epub.EpubBook()
    b.set_identifier("e")
    b.set_title("Emma")
    b.set_language("en")
    c = epub.EpubHtml(title="One", file_name="c1.xhtml", content="<h1>Emma</h1><p>x</p>")
    b.add_item(c)
    b.toc = [c]
    b.spine = ["nav", c]
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    path = tmp_path / "emma.epub"
    epub.write_epub(str(path), b)
    names_before = set(zipfile.ZipFile(path).namelist())

    embed_epub_cover(path, _jpeg(tmp_path / "c.jpg", "green"))

    names_after = set(zipfile.ZipFile(path).namelist())
    assert names_before < names_after  # nothing lost, only the image added
    assert extract_epub_cover(path, tmp_path / "out.jpg")
    epub.read_epub(str(path))  # still a readable EPUB


def test_a_failure_leaves_the_original_file_untouched(tmp_path):
    book = _handmade(tmp_path / "b.epub", opf="<package><metadata/></package>")
    original = book.read_bytes()
    with pytest.raises(CoverExtractionError):
        embed_epub_cover(book, _jpeg(tmp_path / "c.jpg", "red"))
    assert book.read_bytes() == original
    assert not list(tmp_path.glob("*.tmp"))

    broken = tmp_path / "broken.epub"
    broken.write_bytes(b"not a zip")
    with pytest.raises(CoverExtractionError):
        embed_epub_cover(broken, tmp_path / "c.jpg")
    assert broken.read_bytes() == b"not a zip"
