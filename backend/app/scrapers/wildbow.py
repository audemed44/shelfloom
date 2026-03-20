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
    extract_date_from_url,
    normalize_chapter_list,
    rate_limited_sleep,
    strip_html_entities,
)

_KNOWN_HOSTS = {
    "pactwebserial.wordpress.com",
    "palewebserial.wordpress.com",
    "parahumans.wordpress.com",
    "twigserial.wordpress.com",
}

_CONTENT_SELECTORS = (
    "div.entry-content",
    "div.post-content",
)

_TITLE_SELECTORS = (
    ".entry-title",
    ".page-title",
    "header.post-title h1",
    ".post-title",
    "h1",
)

# Matches links whose text looks like a chapter code: "1.01", "0.0", "E.6",
# "1.x", "1.0x", "16.12", etc.  Allows an optional parenthetical suffix
# like "1.x (Interlude; Danny)".
_CHAPTER_CODE_RE = re.compile(r"^\s*[A-Za-z]?\d*\.[\da-z]+(?:\s*\(.*\))?\s*$")


class WildbowAdapter:
    name = "wildbow"

    def can_handle(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").removeprefix("www.").lower()
        return host in _KNOWN_HOSTS

    def _toc_url(self, url: str) -> str:
        parsed = urlparse(url)
        if "table-of-contents" in parsed.path:
            return url
        return f"{parsed.scheme}://{parsed.netloc}/table-of-contents/"

    def _find_content(self, soup: BeautifulSoup) -> object | None:
        for sel in _CONTENT_SELECTORS:
            el = soup.select_one(sel)
            if el:
                return el
        return None

    def _find_title(self, soup: BeautifulSoup) -> str:
        for sel in _TITLE_SELECTORS:
            el = soup.select_one(sel)
            if el:
                return strip_html_entities(el.get_text())
        title_el = soup.find("title")
        return strip_html_entities(title_el.get_text() if title_el else "") or "Untitled"

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        toc_url = self._toc_url(url)
        async with build_client() as client:
            resp = await client.get(toc_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        site_name_el = soup.select_one("meta[property='og:site_name']")
        title = (
            strip_html_entities(site_name_el.get("content") if site_name_el else "")  # type: ignore[arg-type]
            or self._find_title(soup)
        )

        desc_el = soup.select_one("meta[name='description']")
        description = strip_html_entities(desc_el.get("content") if desc_el else "") or None  # type: ignore[arg-type]

        cover_el = soup.select_one("meta[property='og:image']")
        cover_url = cover_el.get("content") if cover_el else None  # type: ignore[union-attr]

        return SerialMetadata(
            title=title,
            author="Wildbow",
            description=description,
            cover_url=str(cover_url) if cover_url else None,
            status="ongoing",
        )

    async def fetch_chapter_list(self, url: str) -> list[ChapterInfo]:
        toc_url = self._toc_url(url)
        async with build_client() as client:
            resp = await client.get(toc_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        content = self._find_content(soup)
        if content is None:
            raise ValueError("Could not find content area on Wildbow table of contents")

        from bs4 import Tag

        assert isinstance(content, Tag)

        base_host = (urlparse(toc_url).hostname or "").removeprefix("www.").lower()
        links: list[tuple[str | None, str, datetime | None]] = []

        from datetime import datetime

        for a in content.select("a[href]"):
            href = str(a.get("href") or "")
            link_text = strip_html_entities(a.get_text())
            if not href or not link_text:
                continue

            abs_href = absolute_url(toc_url, href)
            if not abs_href:
                continue

            parsed = urlparse(abs_href)
            link_host = (parsed.hostname or "").removeprefix("www.").lower()
            if link_host != base_host:
                continue

            # Only accept links that look like chapter codes
            if not _CHAPTER_CODE_RE.match(link_text):
                continue

            # Build a richer title from the parent element if available
            title = self._chapter_title_from_context(a, link_text)
            links.append((abs_href, title, extract_date_from_url(abs_href)))

        chapters = normalize_chapter_list(toc_url, links)
        if not chapters:
            raise ValueError("Could not extract chapter list from Wildbow table of contents")
        return chapters

    def _chapter_title_from_context(self, a_tag: object, link_text: str) -> str:
        """Try to build 'Code – Description' from the parent element."""
        from bs4 import Tag

        assert isinstance(a_tag, Tag)
        parent = a_tag.parent
        if parent and parent.name in ("strong", "b", "em", "p", "span"):
            full = strip_html_entities(parent.get_text())
            # Collapse internal whitespace (newlines from HTML formatting)
            full = re.sub(r"\s+", " ", full).strip()
            if full and full != link_text:
                return full
        return link_text

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")
        title = self._find_title(soup) or "Chapter"

        content = self._find_content(soup)
        if content is None:
            raise ValueError(f"Could not find chapter content at {chapter_url}")

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


_instance = WildbowAdapter()


def get_adapter() -> WildbowAdapter:
    return _instance
