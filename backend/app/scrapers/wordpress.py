from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import (
    ChapterContent,
    ChapterInfo,
    SerialMetadata,
    absolute_url,
    build_client,
    count_words,
    normalize_chapter_list,
    rate_limited_sleep,
    strip_html_entities,
)

_CONTENT_SELECTORS = (
    "div.entry-content",
    "div.post-content",
    "ul.wp-block-post-template",
    ".wp-block-cover__inner-container",
)
_TITLE_SELECTORS = (
    ".entry-title",
    ".page-title",
    "header.post-title h1",
    ".post-title",
    "#chapter-heading",
    ".wp-block-post-title",
    "h1",
)
_CHAPTER_PATTERN = re.compile(r"chapter|prologue|epilogue|part\s+\d+", re.IGNORECASE)
_CHAPTER_PATH_PATTERN = re.compile(r"chapter|prologue|epilogue", re.IGNORECASE)


class WordpressAdapter:
    name = "wordpress-generic"

    def can_handle(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return "wordpress" in host or host.endswith(".blog")

    def _find_title(self, soup: BeautifulSoup) -> str:
        for sel in _TITLE_SELECTORS:
            el = soup.select_one(sel)
            if el:
                return strip_html_entities(el.get_text())
        title_el = soup.find("title")
        return strip_html_entities(title_el.get_text() if title_el else "") or "Untitled"

    def _find_content(self, soup: BeautifulSoup) -> object | None:
        for sel in _CONTENT_SELECTORS:
            el = soup.select_one(sel)
            if el:
                return el
        return None

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        async with build_client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        title = self._find_title(soup)

        author_el = soup.select_one("[rel='author'], .author a, .byline a")
        author = strip_html_entities(author_el.get_text() if author_el else "") or None

        desc_el = soup.select_one("meta[name='description']")
        description = strip_html_entities(desc_el.get("content") if desc_el else "") or None  # type: ignore[arg-type]

        cover_el = soup.select_one("meta[property='og:image']")
        cover_url = cover_el.get("content") if cover_el else None  # type: ignore[union-attr]

        return SerialMetadata(
            title=title,
            author=author,
            description=description,
            cover_url=str(cover_url) if cover_url else None,
            status="ongoing",
        )

    async def fetch_chapter_list(self, url: str) -> list[ChapterInfo]:
        async with build_client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        content = self._find_content(soup)
        if content is None:
            raise ValueError("Could not detect a supported WordPress chapter page")

        from bs4 import Tag

        assert isinstance(content, Tag)

        base_host = urlparse(url).hostname or ""
        links: list[tuple[str | None, str]] = []
        for a in content.select("a[href]"):
            href = str(a.get("href") or "")
            text = strip_html_entities(a.get_text())
            if not href or not text:
                continue
            try:
                abs_href = absolute_url(url, href)
                if not abs_href:
                    continue
                parsed = urlparse(abs_href)
                looks_like_chapter = _CHAPTER_PATTERN.search(text) or _CHAPTER_PATH_PATTERN.search(
                    parsed.path
                )
                if parsed.hostname == base_host and looks_like_chapter:
                    links.append((abs_href, text))
            except Exception:
                continue

        chapters = normalize_chapter_list(url, links)
        if not chapters:
            title_el = soup.select_one("h1") or soup.find("title")
            title = strip_html_entities(title_el.get_text() if title_el else "") or "Chapter 1"
            chapters = [
                ChapterInfo(chapter_number=1, title=title, source_url=url, publish_date=None)
            ]
        return chapters

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")

        title = self._find_title(soup) or "Chapter"

        content = self._find_content(soup)
        if content is None:
            raise ValueError("Could not detect chapter content for this page")

        from bs4 import Tag

        assert isinstance(content, Tag)

        for sel in ["script", "style", "nav", ".sharedaddy", ".jp-relatedposts"]:
            for el in content.select(sel):
                el.decompose()
        for a in content.select("a[rel='next'], a[rel='prev']"):
            a.decompose()
        for a in content.find_all("a"):
            txt = (a.get_text() or "").lower()
            if "next chapter" in txt or "previous chapter" in txt:
                a.decompose()

        html_content = f"<div>{content.decode_contents()}</div>"
        return ChapterContent(
            chapter_number=0,
            title=title,
            html_content=html_content,
            word_count=count_words(html_content),
        )


_instance = WordpressAdapter()


def get_adapter() -> WordpressAdapter:
    return _instance
