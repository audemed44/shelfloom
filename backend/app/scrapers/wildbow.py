from __future__ import annotations

import re
from datetime import datetime
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

# Matches extra material reference like "[0.0]", "[1.2]", "[24.x]"
_EXTRA_REF_RE = re.compile(r"\[(\S+)\]")


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

    def _extras_url(self, url: str) -> str:
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/extra-material/"

    def _is_pale(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").removeprefix("www.").lower()
        return host == "palewebserial.wordpress.com"

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

            # Fetch extra materials page for Pale
            extras_soup = None
            if self._is_pale(toc_url):
                try:
                    extras_resp = await client.get(self._extras_url(toc_url))
                    extras_resp.raise_for_status()
                    extras_soup = BeautifulSoup(extras_resp.text, "html.parser")
                except Exception:
                    pass  # extras are optional

        soup = BeautifulSoup(resp.text, "html.parser")
        chapters = self._parse_toc(soup, toc_url)

        if extras_soup is not None:
            extras = self._parse_extras(extras_soup, toc_url)
            if extras:
                chapters = self._interleave_extras(chapters, extras)

        return chapters

    def _parse_toc(self, soup: BeautifulSoup, toc_url: str) -> list[ChapterInfo]:
        content = self._find_content(soup)
        if content is None:
            raise ValueError("Could not find content area on Wildbow table of contents")

        from bs4 import Tag

        assert isinstance(content, Tag)

        base_host = (urlparse(toc_url).hostname or "").removeprefix("www.").lower()
        links: list[tuple[str | None, str, datetime | None]] = []

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

    def _parse_extras(self, soup: BeautifulSoup, base_url: str) -> list[tuple[str, ChapterInfo]]:
        """Parse the extra materials page. Returns (after_code, ChapterInfo) pairs."""
        content = self._find_content(soup)
        if content is None:
            return []

        from bs4 import Tag

        assert isinstance(content, Tag)

        base_host = (urlparse(base_url).hostname or "").removeprefix("www.").lower()
        extras: list[tuple[str, ChapterInfo]] = []

        for a in content.select("a[href]"):
            href = str(a.get("href") or "")
            link_text = strip_html_entities(a.get_text())
            if not href or not link_text:
                continue

            abs_href = absolute_url(base_url, href)
            if not abs_href:
                continue

            parsed = urlparse(abs_href)
            link_host = (parsed.hostname or "").removeprefix("www.").lower()
            if link_host != base_host:
                continue

            # Find the chapter reference code from surrounding text
            # Pattern: [0.0] <a>Title</a>  or  <strong>[0.0] <a>Title</a></strong>
            parent = a.parent
            if not parent:
                continue

            parent_text = strip_html_entities(parent.get_text()) if isinstance(parent, Tag) else ""
            ref_match = _EXTRA_REF_RE.search(parent_text)
            if not ref_match:
                continue

            after_code = ref_match.group(1)
            title = f"Extra: {link_text}"

            extras.append(
                (
                    after_code,
                    ChapterInfo(
                        chapter_number=0,  # will be assigned during interleaving
                        title=title,
                        source_url=abs_href,
                        publish_date=extract_date_from_url(abs_href),
                    ),
                )
            )

        return extras

    def _interleave_extras(
        self,
        chapters: list[ChapterInfo],
        extras: list[tuple[str, ChapterInfo]],
    ) -> list[ChapterInfo]:
        """Insert extra material entries after the chapter they reference."""
        # Build a map from chapter code (e.g. "0.0") to its position.
        # The chapter code is the first token of the title.
        code_to_idx: dict[str, int] = {}
        for i, ch in enumerate(chapters):
            if ch.title:
                code = ch.title.split()[0].rstrip("–—-")
                code_to_idx[code] = i

        # Group extras by their target position (insert after)
        inserts: dict[int, list[ChapterInfo]] = {}
        for after_code, extra_ch in extras:
            idx = code_to_idx.get(after_code)
            if idx is not None:
                inserts.setdefault(idx, []).append(extra_ch)

        # Build merged list
        merged: list[ChapterInfo] = []
        for i, ch in enumerate(chapters):
            merged.append(ch)
            if i in inserts:
                merged.extend(inserts[i])

        # Re-number all chapters sequentially
        for num, ch in enumerate(merged, start=1):
            ch.chapter_number = num

        return merged

    def _chapter_title_from_context(self, a_tag: object, link_text: str) -> str:
        """Try to build 'Code – Description' from the sibling text after the link.

        Parent elements often contain ALL chapter links for an arc, so we
        extract only the text fragment that belongs to *this* chapter.
        """
        from bs4 import NavigableString, Tag

        assert isinstance(a_tag, Tag)

        sibling = a_tag.next_sibling

        if isinstance(sibling, NavigableString):
            suffix = re.sub(r"\s+", " ", str(sibling)).strip()
            if suffix:
                return f"{link_text} {suffix}"
        elif isinstance(sibling, Tag) and sibling.name not in ("a", "br"):
            # Arc-opening chapters: <a>1.1</a><strong>– Verona<br/>...</strong>
            # Take only the leading text of the sibling tag (before any child element).
            first_text = sibling.find(string=True, recursive=False)
            if first_text:
                suffix = re.sub(r"\s+", " ", str(first_text)).strip()
                if suffix:
                    return f"{link_text} {suffix}"

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
