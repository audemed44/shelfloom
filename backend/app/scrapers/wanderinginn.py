from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import (
    ChapterContent,
    ChapterInfo,
    SerialMetadata,
    build_client,
    count_words,
    extract_date_from_url,
    normalize_chapter_list,
    rate_limited_sleep,
    strip_html_entities,
)


class WanderingInnAdapter:
    name = "wanderinginn"

    def can_handle(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").removeprefix("www.").lower()
        return host == "wanderinginn.com"

    def _toc_url(self, url: str) -> str:
        parsed = urlparse(url)
        if "table-of-contents" in parsed.path:
            return url
        return f"{parsed.scheme}://{parsed.netloc}/table-of-contents/"

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        toc_url = self._toc_url(url)
        async with build_client() as client:
            resp = await client.get(toc_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        desc_el = soup.select_one("meta[name='description']")
        description = strip_html_entities(desc_el.get("content") if desc_el else "") or None  # type: ignore[arg-type]

        cover_el = soup.select_one("meta[property='og:image']")
        cover_url = cover_el.get("content") if cover_el else None  # type: ignore[union-attr]

        return SerialMetadata(
            title="The Wandering Inn",
            author="pirateaba",
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

        from datetime import datetime

        links: list[tuple[str | None, str, datetime | None]] = []
        for el in soup.select("#table-of-contents a"):
            classes = el.get("class") or []
            if any(c in classes for c in ("book-title-num", "volume-book-card")):
                continue
            href = el.get("href")
            href_str = str(href) if href else None
            text = strip_html_entities(el.get_text())
            links.append((href_str, text, extract_date_from_url(href_str)))

        chapters = normalize_chapter_list(toc_url, links)
        if not chapters:
            raise ValueError("Could not extract chapter list from Wandering Inn table of contents")
        return chapters

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")

        content = soup.select_one("div#reader-content")
        if content is None:
            raise ValueError(f"Could not find Wandering Inn chapter content at {chapter_url}")

        self._preprocess_raw_dom(content)
        for a in content.select("a[href*='https://wanderinginn.com/']"):
            a.decompose()

        title = self._extract_chapter_title(soup) or "Chapter"

        html_content = f"<div>{content.decode_contents()}</div>"
        return ChapterContent(
            chapter_number=0,
            title=title,
            html_content=html_content,
            word_count=count_words(html_content),
        )

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str | None:
        for el in soup.select("h2.elementor-heading-title"):
            text = strip_html_entities(el.get_text())
            if text and text.lower() != "loading...":
                return text
        return None

    def _preprocess_raw_dom(self, content: object) -> None:
        from bs4 import Tag

        assert isinstance(content, Tag)
        for el in content.select(".mrsha-write"):
            style = (el.get("style") or "").strip()
            if not re.search(r"font-style\s*:\s*italic", style, re.IGNORECASE):
                sep = ";" if style and not style.endswith(";") else ""
                style = f"{style}{sep}font-style: italic;"
            el["style"] = style

        for el in content.select("span[style*='color:']"):
            classes: list[str] = list(el.get("class") or [])
            if "ibooks-dark-theme-use-custom-text-color" not in classes:
                classes.append("ibooks-dark-theme-use-custom-text-color")
            el["class"] = classes


_instance = WanderingInnAdapter()


def get_adapter() -> WanderingInnAdapter:
    return _instance
