from __future__ import annotations

import asyncio
import html
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from urllib.parse import urljoin, urlparse

import httpx

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

_RATE_LIMIT_SECONDS = 1.5


@dataclass
class SerialMetadata:
    title: str
    author: str | None
    description: str | None
    cover_url: str | None
    status: str  # "ongoing" | "completed"


@dataclass
class ChapterInfo:
    chapter_number: int
    title: str | None
    source_url: str
    publish_date: datetime | None


@dataclass
class ChapterContent:
    chapter_number: int
    title: str | None
    html_content: str
    word_count: int


class ScraperAdapter(Protocol):
    name: str

    def can_handle(self, url: str) -> bool: ...

    async def fetch_metadata(self, url: str) -> SerialMetadata: ...

    async def fetch_chapter_list(self, url: str) -> list[ChapterInfo]: ...

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent: ...


def strip_html_entities(text: str | None) -> str:
    if not text:
        return ""
    return html.unescape(text).strip()


def absolute_url(base: str, href: str | None) -> str | None:
    if not href:
        return None
    try:
        result = urljoin(base, href)
        parsed = urlparse(result)
        if parsed.scheme not in ("http", "https"):
            return None
        # strip fragment
        return result.split("#")[0]
    except Exception:
        return None


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(fragment="").geturl()


def build_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=_DEFAULT_HEADERS, follow_redirects=True, timeout=30.0)


def normalize_chapter_list(
    base_url: str,
    links: list[tuple[str | None, str]],  # (href, text)
) -> list[ChapterInfo]:
    seen: dict[str, ChapterInfo] = {}
    chapter_number = 1
    for href, text in links:
        url = absolute_url(base_url, href)
        if not url or url in seen:
            continue
        title = strip_html_entities(text) or url
        seen[url] = ChapterInfo(
            chapter_number=chapter_number,
            title=title,
            source_url=url,
            publish_date=None,
        )
        chapter_number += 1
    return list(seen.values())


def count_words(html_content: str) -> int:
    text = re.sub(r"<[^>]+>", " ", html_content)
    text = html.unescape(text)
    return len(text.split())


async def rate_limited_sleep() -> None:
    await asyncio.sleep(_RATE_LIMIT_SECONDS)
