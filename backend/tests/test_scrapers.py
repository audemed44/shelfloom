"""Tests for scraping adapters using mocked httpx responses."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.scrapers.base import (
    absolute_url,
    count_words,
    normalize_chapter_list,
    normalize_url,
    strip_html_entities,
)
from app.scrapers.novelfire import NovelFireAdapter
from app.scrapers.registry import get_adapter, source_name
from app.scrapers.royalroad import RoyalRoadAdapter
from app.scrapers.sequential import SequentialNextLinkAdapter
from app.scrapers.wanderinginn import WanderingInnAdapter
from app.scrapers.wordpress import WordpressAdapter

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _make_response(
    html: str, status: int = 200, url: str = "https://example.com"
) -> httpx.Response:
    return httpx.Response(status, text=html, request=httpx.Request("GET", url))


def _mock_client(responses: list[httpx.Response]):
    """Return an async context manager whose .get() yields responses in order."""
    call_count = 0

    async def _get(url, **kwargs):
        nonlocal call_count
        resp = responses[min(call_count, len(responses) - 1)]
        call_count += 1
        return resp

    client = AsyncMock()
    client.get = _get
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


# ---------------------------------------------------------------------------
# Base utilities
# ---------------------------------------------------------------------------


def test_strip_html_entities():
    assert strip_html_entities("Hello &amp; World") == "Hello & World"
    assert strip_html_entities("  spaces  ") == "spaces"
    assert strip_html_entities(None) == ""
    assert strip_html_entities("") == ""


def test_absolute_url():
    assert absolute_url("https://example.com/page", "/chapter/1") == "https://example.com/chapter/1"
    assert absolute_url("https://example.com/page", "https://other.com/a") == "https://other.com/a"
    assert absolute_url("https://example.com", None) is None
    assert absolute_url("https://example.com", "") is None
    # fragment stripped
    result = absolute_url("https://example.com", "/page#section")
    assert result is not None
    assert "#" not in result


def test_normalize_url():
    assert normalize_url("https://example.com/page#anchor") == "https://example.com/page"
    assert normalize_url("https://example.com/page") == "https://example.com/page"


def test_count_words():
    assert count_words("<p>Hello world</p>") == 2
    assert count_words("<p></p>") == 0
    assert count_words("one two three") == 3


def test_normalize_chapter_list_dedup():
    links = [
        ("/ch/1", "Chapter 1", None),
        ("/ch/1", "Duplicate", None),
        ("/ch/2", "Chapter 2", None),
    ]
    chapters = normalize_chapter_list("https://example.com", links)
    assert len(chapters) == 2
    assert chapters[0].chapter_number == 1
    assert chapters[1].chapter_number == 2
    assert chapters[0].title == "Chapter 1"


def test_normalize_chapter_list_invalid_href():
    links = [(None, "Chapter 1", None), ("javascript:void(0)", "Bad", None)]
    chapters = normalize_chapter_list("https://example.com", links)
    assert len(chapters) == 0


def test_absolute_url_non_http_scheme():
    # ftp:// and data: URIs should be rejected
    assert absolute_url("https://example.com", "ftp://other.com/file") is None
    assert absolute_url("https://example.com", "data:text/plain,hello") is None


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_get_adapter_royalroad():
    a = get_adapter("https://www.royalroad.com/fiction/12345/my-story")
    assert a is not None
    assert a.name == "royalroad"


def test_get_adapter_novelfire():
    a = get_adapter("https://novelfire.net/novel/12345")
    assert a is not None
    assert a.name == "novelfire"


def test_get_adapter_wanderinginn():
    a = get_adapter("https://wanderinginn.com/table-of-contents/")
    assert a is not None
    assert a.name == "wanderinginn"


def test_get_adapter_wordpress():
    a = get_adapter("https://mynovel.wordpress.com/")
    assert a is not None
    assert a.name == "wordpress-generic"


def test_get_adapter_sequential():
    a = get_adapter("https://example.com/chapter-1-prologue")
    assert a is not None
    assert a.name == "sequential-next-link"


def test_get_adapter_unknown():
    # Plain root domain with no chapter-like path
    a = get_adapter("https://example.com/")
    # sequential-next-link won't match plain root
    assert a is None or a.name == "sequential-next-link"


def test_source_name():
    assert source_name("https://royalroad.com/fiction/1/title") == "royalroad"


# ---------------------------------------------------------------------------
# RoyalRoad
# ---------------------------------------------------------------------------

_RR_STORY_HTML = """
<html><body>
<div class="fic-header">
  <div class="col"><h1>My Story</h1></div>
  <h4><span><a>AuthorName</a></span></h4>
</div>
<div class="fiction-info"><div class="description">Great story</div></div>
<img class="thumbnail" src="https://cdn.royalroad.com/cover.jpg" />
<table id="chapters">
  <tr>
    <td><a href="/fiction/1/my-story/chapter/100/ch1">Chapter 1</a></td>
    <td><time datetime="2025-01-15T12:00:00Z">Jan 15</time></td>
  </tr>
  <tr>
    <td><a href="/fiction/1/my-story/chapter/101/ch2">Chapter 2</a></td>
    <td><time datetime="2025-01-22T12:00:00Z">Jan 22</time></td>
  </tr>
</table>
</body></html>
"""

_RR_CHAPTER_HTML = """
<html><body>
<h1>Chapter 1: The Beginning</h1>
<div class="portlet-body">
  <div class="chapter-inner">
    <p>Once upon a time</p>
    <p>there was a story.</p>
  </div>
</div>
</body></html>
"""


class TestRoyalRoadAdapter:
    def setup_method(self):
        self.adapter = RoyalRoadAdapter()

    def test_can_handle(self):
        assert self.adapter.can_handle("https://royalroad.com/fiction/1/story")
        assert self.adapter.can_handle("https://www.royalroad.com/fiction/1/story")
        assert self.adapter.can_handle("https://royalroadl.com/fiction/1/story")
        assert not self.adapter.can_handle("https://example.com/fiction/1")

    def test_story_url(self):
        url = "https://royalroad.com/fiction/12345/my-story"
        assert self.adapter._story_url(url) == "https://royalroad.com/fiction/12345/my-story"

    def test_story_url_chapter_page(self):
        url = "https://royalroad.com/fiction/12345/my-story/chapter/99999/ch"
        result = self.adapter._story_url(url)
        assert "/chapter/" not in result
        assert "12345" in result

    @pytest.mark.asyncio
    async def test_fetch_metadata(self):
        resp = _make_response(_RR_STORY_HTML, url="https://royalroad.com/fiction/1/my-story")
        with patch("app.scrapers.royalroad.build_client", return_value=_mock_client([resp])):
            meta = await self.adapter.fetch_metadata("https://royalroad.com/fiction/1/my-story")
        assert meta.title == "My Story"
        assert meta.author == "AuthorName"
        assert meta.cover_url == "https://cdn.royalroad.com/cover.jpg"
        assert meta.description == "Great story"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list(self):
        resp = _make_response(_RR_STORY_HTML, url="https://royalroad.com/fiction/1/my-story")
        with patch("app.scrapers.royalroad.build_client", return_value=_mock_client([resp])):
            chapters = await self.adapter.fetch_chapter_list(
                "https://royalroad.com/fiction/1/my-story"
            )
        assert len(chapters) == 2
        assert chapters[0].title == "Chapter 1"
        assert chapters[1].chapter_number == 2
        assert chapters[0].publish_date is not None
        assert chapters[0].publish_date.year == 2025
        assert chapters[0].publish_date.month == 1
        assert chapters[0].publish_date.day == 15

    @pytest.mark.asyncio
    async def test_fetch_chapter_content(self):
        resp = _make_response(_RR_CHAPTER_HTML)
        with (
            patch("app.scrapers.royalroad.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.royalroad.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content(
                "https://royalroad.com/fiction/1/story/chapter/100/ch1"
            )
        assert "Chapter 1" in content.title
        assert "Once upon a time" in content.html_content
        assert content.word_count > 0

    @pytest.mark.asyncio
    async def test_fetch_chapter_content_no_portlet(self):
        # .page-content-wrapper fallback — children must be chapter-inner divs
        # to survive _keep_only_wanted_top_level
        html = (
            "<html><body><h1>Chapter</h1>"
            "<div class='page-content-wrapper'>"
            "<div class='chapter-inner'><p>Text</p></div>"
            "</div></body></html>"
        )
        resp = _make_response(html)
        with (
            patch("app.scrapers.royalroad.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.royalroad.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content(
                "https://royalroad.com/fiction/1/story/chapter/100/ch1"
            )
        assert "Text" in content.html_content

    def test_remove_advertisement_blocks(self):
        from bs4 import BeautifulSoup

        html = """<div>
        <div class="portlet">Advertisement</div>
        <div class="portlet">Normal content</div>
        </div>"""
        soup = BeautifulSoup(html, "html.parser")
        container = soup.find("div")
        self.adapter._remove_advertisement_blocks(container)
        portlets = container.select("div.portlet")
        assert len(portlets) == 1
        assert "Normal content" in portlets[0].get_text()

    def test_remove_problematic_inline_styles(self):
        from bs4 import BeautifulSoup

        html = '<div><p style="color: red; border: 1px solid black;">text</p></div>'
        soup = BeautifulSoup(html, "html.parser")
        container = soup.find("div")
        self.adapter._remove_problematic_inline_styles(container)
        p = container.find("p")
        style = p.get("style") or ""
        assert "border" not in style
        assert "color" in style


# ---------------------------------------------------------------------------
# NovelFire
# ---------------------------------------------------------------------------

_NF_CHAPTERS_HTML = """
<html><body>
<div class="novel-info"><h1>Fire Novel</h1></div>
<span itemprop="author">NF Author</span>
<meta name="description" content="An epic tale" />
<meta property="og:image" content="https://novelfire.net/cover.jpg" />
<ul class="chapter-list">
  <li><a href="/novel/1/chapter-1"><span class="chapter-title">Chapter 1</span></a></li>
  <li><a href="/novel/1/chapter-2"><span class="chapter-title">Chapter 2</span></a></li>
</ul>
</body></html>
"""

_NF_CHAPTER_HTML = """
<html><body>
<span class="chapter-title">Chapter 1: Fire</span>
<div class="chapter-content">
  <p>The fire burned bright.</p>
</div>
</body></html>
"""


class TestNovelFireAdapter:
    def setup_method(self):
        self.adapter = NovelFireAdapter()

    def test_can_handle(self):
        assert self.adapter.can_handle("https://novelfire.net/novel/123")
        assert self.adapter.can_handle("https://www.novelfire.net/novel/123")
        assert not self.adapter.can_handle("https://royalroad.com/fiction/1")

    def test_story_root(self):
        assert (
            self.adapter._story_root("https://novelfire.net/novel/1/chapters")
            == "https://novelfire.net/novel/1"
        )
        assert (
            self.adapter._story_root("https://novelfire.net/novel/1/")
            == "https://novelfire.net/novel/1"
        )

    @pytest.mark.asyncio
    async def test_fetch_metadata(self):
        resp = _make_response(_NF_CHAPTERS_HTML, url="https://novelfire.net/novel/1/chapters")
        with patch("app.scrapers.novelfire.build_client", return_value=_mock_client([resp])):
            meta = await self.adapter.fetch_metadata("https://novelfire.net/novel/1")
        assert meta.title == "Fire Novel"
        assert meta.author == "NF Author"
        assert meta.cover_url == "https://novelfire.net/cover.jpg"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_html_only(self):
        resp = _make_response(_NF_CHAPTERS_HTML, url="https://novelfire.net/novel/1/chapters")
        with patch("app.scrapers.novelfire.build_client", return_value=_mock_client([resp])):
            chapters = await self.adapter.fetch_chapter_list("https://novelfire.net/novel/1")
        assert len(chapters) == 2
        assert chapters[0].title == "Chapter 1"

    @pytest.mark.asyncio
    async def test_fetch_chapter_content(self):
        resp = _make_response(_NF_CHAPTER_HTML)
        with (
            patch("app.scrapers.novelfire.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.novelfire.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content(
                "https://novelfire.net/novel/1/chapter-1"
            )
        assert "Fire" in content.title
        assert "fire burned" in content.html_content

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_ajax_fallback(self):
        ajax_html = _NF_CHAPTERS_HTML.replace(
            "</body>",
            "<script>var url='/listChapterDataAjax?novel_id=1';</script>"
            "<script>var host='https://novelfire.net/';</script></body>",
        )
        page_resp = _make_response(ajax_html, url="https://novelfire.net/novel/1/chapters")
        ajax_resp = httpx.Response(
            200,
            json={
                "data": [
                    {"n_sort": 1, "title": "Chapter 1"},
                    {"n_sort": 2, "title": "Chapter 2"},
                    {"n_sort": 3, "title": "Chapter 3"},
                ],
                "recordsTotal": 3,
            },
            request=httpx.Request("GET", "https://novelfire.net/listChapterDataAjax"),
        )
        # fetch_chapter_list opens build_client() twice: once for the page HTML,
        # and once inside _fetch_all_ajax_chapters. Both share the same mock.
        with patch(
            "app.scrapers.novelfire.build_client", return_value=_mock_client([page_resp, ajax_resp])
        ):
            chapters = await self.adapter.fetch_chapter_list("https://novelfire.net/novel/1")
        # AJAX returns 3 chapters, HTML returns 2 — AJAX wins
        assert len(chapters) == 3

    def test_remove_watermark_paragraphs(self):
        from bs4 import BeautifulSoup

        html = '<div><p class="watermark">ad text</p><p>real text</p></div>'
        soup = BeautifulSoup(html, "html.parser")
        content = soup.find("div")
        self.adapter._remove_watermark_paragraphs(content)
        assert len(content.find_all("p")) == 1
        assert "real text" in content.get_text()

    def test_remove_dl_info_blocks(self):
        from bs4 import BeautifulSoup

        html = "<div><div><dl><dt>Info</dt><dd>Value</dd></dl></div><p>keep</p></div>"
        soup = BeautifulSoup(html, "html.parser")
        content = soup.find("div")
        self.adapter._remove_dl_info_blocks(content)
        assert "Info" not in content.get_text()
        assert "keep" in content.get_text()

    def test_remove_nested_strong_tags(self):
        from bs4 import BeautifulSoup

        html = "<div><p><strong><strong>inner</strong></strong>keep</p></div>"
        soup = BeautifulSoup(html, "html.parser")
        content = soup.find("div")
        self.adapter._remove_nested_strong_tags(content)
        assert "inner" not in content.get_text()

    def test_get_adapter_module_function(self):
        from app.scrapers.novelfire import get_adapter

        a = get_adapter()
        assert a.name == "novelfire"

    def test_extract_ajax_endpoint_no_fragment(self):
        # marker present but fragment regex fails (trailing quote immediately)
        html = "var x='/listChapterDataAjax';"
        result = self.adapter._extract_ajax_endpoint(html, "https://novelfire.net/novel/1/chapters")
        assert result is None

    def test_extract_ajax_endpoint_no_host(self):
        # marker + fragment present but no HTTPS host in page
        html = "var x='/listChapterDataAjax?novel_id=1 x';"
        result = self.adapter._extract_ajax_endpoint(html, "https://novelfire.net/novel/1/chapters")
        assert result is None


# ---------------------------------------------------------------------------
# WanderingInn
# ---------------------------------------------------------------------------

_WI_TOC_HTML = """
<html><body>
<meta name="description" content="A great inn" />
<meta property="og:image" content="https://wanderinginn.com/cover.jpg" />
<div id="table-of-contents">
  <a class="book-title-num">Volume 1</a>
  <a href="/2019/01/01/chapter-1-the-inn">Chapter 1 – The Inn</a>
  <a href="/2019/01/08/chapter-2-guests">Chapter 2 – Guests</a>
</div>
</body></html>
"""

_WI_CHAPTER_HTML = """
<html><body>
<h2 class="elementor-heading-title">Chapter 1 – The Inn</h2>
<div id="reader-content">
  <p>Erin opened the door.</p>
  <p class="mrsha-write" style="color: white">Mrsha wrote something.</p>
</div>
</body></html>
"""


class TestWanderingInnAdapter:
    def setup_method(self):
        self.adapter = WanderingInnAdapter()

    def test_can_handle(self):
        assert self.adapter.can_handle("https://wanderinginn.com/2019/01/01/chapter-1")
        assert self.adapter.can_handle("https://www.wanderinginn.com/table-of-contents/")
        assert not self.adapter.can_handle("https://royalroad.com/fiction/1")

    def test_toc_url(self):
        assert "table-of-contents" in self.adapter._toc_url("https://wanderinginn.com/")
        assert (
            self.adapter._toc_url("https://wanderinginn.com/table-of-contents/")
            == "https://wanderinginn.com/table-of-contents/"
        )

    @pytest.mark.asyncio
    async def test_fetch_metadata(self):
        resp = _make_response(_WI_TOC_HTML)
        with patch("app.scrapers.wanderinginn.build_client", return_value=_mock_client([resp])):
            meta = await self.adapter.fetch_metadata("https://wanderinginn.com/")
        assert meta.title == "The Wandering Inn"
        assert meta.author == "pirateaba"
        assert meta.cover_url == "https://wanderinginn.com/cover.jpg"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list(self):
        resp = _make_response(_WI_TOC_HTML)
        with patch("app.scrapers.wanderinginn.build_client", return_value=_mock_client([resp])):
            chapters = await self.adapter.fetch_chapter_list("https://wanderinginn.com/")
        assert len(chapters) == 2
        assert chapters[0].title == "Chapter 1 – The Inn"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_empty_raises(self):
        resp = _make_response("<html><body><div id='table-of-contents'></div></body></html>")
        with (
            patch("app.scrapers.wanderinginn.build_client", return_value=_mock_client([resp])),
            pytest.raises(ValueError, match="Could not extract"),
        ):
            await self.adapter.fetch_chapter_list("https://wanderinginn.com/")

    @pytest.mark.asyncio
    async def test_fetch_chapter_content(self):
        resp = _make_response(_WI_CHAPTER_HTML)
        with (
            patch("app.scrapers.wanderinginn.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.wanderinginn.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content(
                "https://wanderinginn.com/2019/01/01/chapter-1"
            )
        assert "Inn" in content.title
        assert "Erin" in content.html_content
        assert "italic" in content.html_content  # mrsha-write gets italic style

    @pytest.mark.asyncio
    async def test_fetch_chapter_content_missing_reader(self):
        resp = _make_response("<html><body><p>no content div</p></body></html>")
        with (
            patch("app.scrapers.wanderinginn.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.wanderinginn.rate_limited_sleep", new_callable=AsyncMock),
            pytest.raises(ValueError, match="Could not find"),
        ):
            await self.adapter.fetch_chapter_content("https://wanderinginn.com/2019/01/01/ch")


# ---------------------------------------------------------------------------
# WordPress
# ---------------------------------------------------------------------------

_WP_TOC_HTML = """
<html><body>
<h1 class="entry-title">My WP Novel</h1>
<span rel="author">WP Author</span>
<meta name="description" content="A WordPress novel" />
<meta property="og:image" content="https://mynovel.wordpress.com/cover.jpg" />
<div class="entry-content">
  <a href="https://mynovel.wordpress.com/chapter-1-start">Chapter 1 Start</a>
  <a href="https://mynovel.wordpress.com/chapter-2-middle">Chapter 2 Middle</a>
  <a href="https://mynovel.wordpress.com/about">About (skip)</a>
</div>
</body></html>
"""

_WP_CHAPTER_HTML = """
<html><body>
<h1 class="entry-title">Chapter 1</h1>
<div class="entry-content">
  <p>The story began here.</p>
  <a rel="next" href="/chapter-2">Next</a>
</div>
</body></html>
"""


class TestWordpressAdapter:
    def setup_method(self):
        self.adapter = WordpressAdapter()

    def test_can_handle(self):
        assert self.adapter.can_handle("https://mynovel.wordpress.com/")
        assert self.adapter.can_handle("https://story.blog/chapter-1")
        assert not self.adapter.can_handle("https://royalroad.com/fiction/1")

    @pytest.mark.asyncio
    async def test_fetch_metadata(self):
        resp = _make_response(_WP_TOC_HTML, url="https://mynovel.wordpress.com/")
        with patch("app.scrapers.wordpress.build_client", return_value=_mock_client([resp])):
            meta = await self.adapter.fetch_metadata("https://mynovel.wordpress.com/")
        assert meta.title == "My WP Novel"
        assert meta.cover_url == "https://mynovel.wordpress.com/cover.jpg"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list(self):
        resp = _make_response(_WP_TOC_HTML, url="https://mynovel.wordpress.com/")
        with patch("app.scrapers.wordpress.build_client", return_value=_mock_client([resp])):
            chapters = await self.adapter.fetch_chapter_list("https://mynovel.wordpress.com/")
        assert len(chapters) == 2
        assert "Chapter 1" in chapters[0].title

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_no_links_returns_single(self):
        html = """<html><body>
        <h1 class="entry-title">Chapter 1</h1>
        <div class="entry-content"><p>Content</p></div>
        </body></html>"""
        resp = _make_response(html, url="https://mynovel.wordpress.com/chapter-1")
        with patch("app.scrapers.wordpress.build_client", return_value=_mock_client([resp])):
            chapters = await self.adapter.fetch_chapter_list(
                "https://mynovel.wordpress.com/chapter-1"
            )
        assert len(chapters) == 1

    @pytest.mark.asyncio
    async def test_fetch_chapter_content(self):
        resp = _make_response(_WP_CHAPTER_HTML)
        with (
            patch("app.scrapers.wordpress.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.wordpress.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content(
                "https://mynovel.wordpress.com/chapter-1"
            )
        assert content.title == "Chapter 1"
        assert "story began" in content.html_content
        # nav link removed
        assert 'rel="next"' not in content.html_content

    @pytest.mark.asyncio
    async def test_fetch_chapter_content_no_content_raises(self):
        html = "<html><body><p>no content div</p></body></html>"
        resp = _make_response(html)
        with (
            patch("app.scrapers.wordpress.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.wordpress.rate_limited_sleep", new_callable=AsyncMock),
            pytest.raises(ValueError, match="Could not detect"),
        ):
            await self.adapter.fetch_chapter_content("https://mynovel.wordpress.com/ch1")


# ---------------------------------------------------------------------------
# Sequential next-link
# ---------------------------------------------------------------------------

_SEQ_CH1_HTML = """
<html><head>
<title>Chapter 1 | My Blog Novel</title>
<meta property="og:site_name" content="My Blog Novel" />
</head><body>
<h1>Chapter 1</h1>
<div class="entry-content">
  <p>First chapter content.</p>
  <a rel="next" href="/chapter-2-the-journey">Next Chapter</a>
</div>
</body></html>
"""

_SEQ_CH2_HTML = """
<html><head>
<title>Chapter 2 | My Blog Novel</title>
<meta property="og:site_name" content="My Blog Novel" />
</head><body>
<h1>Chapter 2</h1>
<div class="entry-content">
  <p>Second chapter content.</p>
</div>
</body></html>
"""


class TestSequentialNextLinkAdapter:
    def setup_method(self):
        self.adapter = SequentialNextLinkAdapter()

    def test_can_handle_date_path(self):
        assert self.adapter.can_handle("https://example.com/2019/01/01/my-post")

    def test_can_handle_chapter_path(self):
        assert self.adapter.can_handle("https://example.com/chapter-1-prologue")

    def test_cannot_handle_plain_root(self):
        assert not self.adapter.can_handle("https://example.com/")

    @pytest.mark.asyncio
    async def test_fetch_metadata(self):
        resp = _make_response(_SEQ_CH1_HTML, url="https://example.com/chapter-1")
        with patch("app.scrapers.sequential.build_client", return_value=_mock_client([resp])):
            meta = await self.adapter.fetch_metadata("https://example.com/chapter-1")
        assert meta.title == "My Blog Novel"

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_two_chapters(self):
        # _collect_sequential_chapters opens a single build_client() context,
        # so all responses come through the same client instance.
        resp1 = _make_response(_SEQ_CH1_HTML, url="https://example.com/chapter-1")
        resp2 = _make_response(_SEQ_CH2_HTML, url="https://example.com/chapter-2-the-journey")

        with (
            patch(
                "app.scrapers.sequential.build_client", return_value=_mock_client([resp1, resp2])
            ),
            patch("app.scrapers.sequential.rate_limited_sleep", new_callable=AsyncMock),
        ):
            chapters = await self.adapter.fetch_chapter_list("https://example.com/chapter-1")
        assert len(chapters) == 2
        assert "Chapter 1" in chapters[0].title
        assert "Chapter 2" in chapters[1].title

    @pytest.mark.asyncio
    async def test_fetch_chapter_list_http_error_raises(self):
        # A connection error should propagate, not silently return empty list
        async def _get(url, **kwargs):
            raise httpx.ConnectError("connection refused")

        client = AsyncMock()
        client.get = _get
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=client)
        cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.scrapers.sequential.build_client", return_value=cm),
            pytest.raises(httpx.ConnectError),
        ):
            await self.adapter.fetch_chapter_list("https://example.com/chapter-1")

    @pytest.mark.asyncio
    async def test_fetch_chapter_content(self):
        resp = _make_response(_SEQ_CH1_HTML)
        with (
            patch("app.scrapers.sequential.build_client", return_value=_mock_client([resp])),
            patch("app.scrapers.sequential.rate_limited_sleep", new_callable=AsyncMock),
        ):
            content = await self.adapter.fetch_chapter_content("https://example.com/chapter-1")
        assert "Chapter 1" in content.title
        assert "First chapter" in content.html_content
        # next link removed
        assert 'rel="next"' not in content.html_content

    def test_title_from_slug(self):
        assert (
            self.adapter._title_from_slug("https://example.com/chapter-1-the-journey")
            == "Chapter 1 The Journey"
        )

    def test_title_from_slug_version(self):
        result = self.adapter._title_from_slug("https://example.com/chapter-1-2")
        assert "1.2" in result

    def test_resolve_on_host_same_host(self):
        result = self.adapter._resolve_on_host("https://example.com/ch1", "/ch2", "example.com")
        assert result == "https://example.com/ch2"

    def test_resolve_on_host_different_host(self):
        result = self.adapter._resolve_on_host(
            "https://example.com/ch1", "https://other.com/ch2", "example.com"
        )
        assert result is None
