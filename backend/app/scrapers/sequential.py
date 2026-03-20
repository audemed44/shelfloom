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
    normalize_url,
    rate_limited_sleep,
    strip_html_entities,
)

_CONTENT_SELECTORS = ", ".join(
    [
        "article .entry-content",
        "div.entry-content",
        "div.post-content",
        "article .post-content",
        "article .post-body",
        "div#reader-content",
        "main article",
        "article",
    ]
)
_TITLE_SELECTORS = ", ".join(
    [
        "h1.entry-title",
        "h1.post-title",
        "h1.wp-block-post-title",
        "header .entry-title",
        "article h1",
        "h1",
    ]
)
_DATE_PATH_PATTERN = re.compile(r"/\d{4}/\d{2}/\d{2}/")
_CHAPTER_PATH_PATTERN = re.compile(r"chapter|arc|interlude|prologue|epilogue", re.IGNORECASE)
_NAV_SELECTORS = [
    "#nav-below .nav-next a[rel='next']",
    "#nav-below .nav-next a",
    "a[rel='next']",
    ".post-navigation .nav-next a",
    ".site-navigation.post-navigation .nav-next a",
    ".nav-next a",
    ".navigation .next a",
]
_MAX_CHAPTERS = 2000


class SequentialNextLinkAdapter:
    name = "sequential-next-link"

    def can_handle(self, url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if _DATE_PATH_PATTERN.search(parsed.path):
            return True
        return bool(_CHAPTER_PATH_PATTERN.search(parsed.path.lower()))

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        start_url = normalize_url(url)
        async with build_client() as client:
            resp = await client.get(start_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        site_name_el = soup.select_one("meta[property='og:site_name']")
        og_title_el = soup.select_one("meta[property='og:title']")
        story_title = (
            strip_html_entities(site_name_el.get("content") if site_name_el else "")  # type: ignore[arg-type]
            or strip_html_entities(og_title_el.get("content") if og_title_el else "")  # type: ignore[arg-type]
            or self._extract_chapter_title(soup, start_url, None)
            or "Untitled"
        )

        author_el = soup.select_one("[rel='author'], .author a, .byline a")
        author_meta = soup.select_one("meta[name='author']")
        author = (
            strip_html_entities(author_meta.get("content") if author_meta else "")  # type: ignore[arg-type]
            or strip_html_entities(author_el.get_text() if author_el else "")
            or None
        )

        desc_el = soup.select_one("meta[name='description']")
        description = strip_html_entities(desc_el.get("content") if desc_el else "") or None  # type: ignore[arg-type]

        cover_el = soup.select_one("meta[property='og:image']")
        cover_url = cover_el.get("content") if cover_el else None  # type: ignore[union-attr]

        return SerialMetadata(
            title=story_title,
            author=author,
            description=description,
            cover_url=str(cover_url) if cover_url else None,
            status="ongoing",
        )

    async def fetch_chapter_list(self, url: str) -> list[ChapterInfo]:
        """Collect chapters by following next-chapter links sequentially.

        This can be slow for long serials (1–2s per chapter page). The caller
        should treat this as a potentially long-running operation.
        """
        start_url = normalize_url(url)
        # story_title is used to de-bias title extraction (avoids returning the
        # site name as the chapter title). Fetch it lazily during traversal.
        chapters = await self._collect_sequential_chapters(start_url, "")
        if not chapters:
            raise ValueError("Could not discover chapters by traversing next links")
        return chapters

    async def _collect_sequential_chapters(
        self, start_url: str, story_title: str
    ) -> list[ChapterInfo]:
        chapters: list[ChapterInfo] = []
        seen: set[str] = set()
        start_host = (urlparse(start_url).hostname or "").removeprefix("www.").lower()
        current_url: str | None = normalize_url(start_url)

        async with build_client() as client:
            while current_url and current_url not in seen and len(chapters) < _MAX_CHAPTERS:
                seen.add(current_url)
                resp = await client.get(current_url)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")

                title = (
                    self._extract_chapter_title(soup, current_url, story_title)
                    or f"Chapter {len(chapters) + 1}"
                )
                chapters.append(
                    ChapterInfo(
                        chapter_number=len(chapters) + 1,
                        title=title,
                        source_url=current_url,
                        publish_date=extract_date_from_url(current_url),
                    )
                )

                next_url = self._find_next_url(soup, current_url, start_host)
                if not next_url or next_url in seen:
                    break
                current_url = next_url
                await rate_limited_sleep()

        return chapters

    def _find_next_url(
        self, soup: BeautifulSoup, current_url: str, allowed_host: str
    ) -> str | None:
        candidates: list[tuple[str, int]] = []

        def push(href: str | None, score: int) -> None:
            if not href:
                return
            resolved = self._resolve_on_host(current_url, href, allowed_host)
            if resolved:
                candidates.append((resolved, score))

        link_next = soup.select_one("link[rel='next']")
        push(str(link_next.get("href") or "") if link_next else None, 100)

        for sel in _NAV_SELECTORS:
            el = soup.select_one(sel)
            push(str(el.get("href") or "") if el else None, 90)

        for a in soup.find_all("a", href=True):
            text = strip_html_entities(a.get_text()).lower()
            if not text:
                continue
            if (
                text.startswith("next")
                or "next chapter" in text
                or "next part" in text
                or text.endswith("→")
            ):
                push(str(a.get("href") or ""), 70)

        if not candidates:
            return None

        best: dict[str, int] = {}
        for href, score in candidates:
            if score > best.get(href, -1):
                best[href] = score

        return max(best, key=lambda h: best[h])

    def _resolve_on_host(self, current_url: str, href: str, allowed_host: str) -> str | None:
        try:
            from urllib.parse import urljoin

            resolved = normalize_url(urljoin(current_url, href))
            host = (urlparse(resolved).hostname or "").removeprefix("www.").lower()
            return resolved if host == allowed_host else None
        except Exception:
            return None

    def _extract_chapter_title(
        self, soup: BeautifulSoup, page_url: str, story_title: str | None
    ) -> str | None:
        raw_heading = strip_html_entities(
            (soup.select_one(_TITLE_SELECTORS) or soup.new_tag("span")).get_text()
        )
        og_title_el = soup.select_one("meta[property='og:title']")
        og_title = strip_html_entities(og_title_el.get("content") if og_title_el else "")  # type: ignore[arg-type]
        doc_title_el = soup.find("title")
        doc_title = strip_html_entities(
            doc_title_el.get_text().split("|")[0] if doc_title_el else ""
        )

        for candidate in [raw_heading, og_title, doc_title]:
            if candidate and (not story_title or candidate.lower() != story_title.lower()):
                return candidate

        return self._title_from_slug(page_url)

    def _title_from_slug(self, page_url: str) -> str:
        parsed = urlparse(page_url)
        parts = [p for p in parsed.path.split("/") if p]
        slug = parts[-1] if parts else "chapter"
        dot_version = re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", slug)
        words = re.split(r"[-_]+", dot_version)
        return " ".join(
            w if re.match(r"^\d+(?:\.\d+)?$", w) else w.capitalize() for w in words if w
        )

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")

        site_name_el = soup.select_one("meta[property='og:site_name']")
        story_title = strip_html_entities(site_name_el.get("content") if site_name_el else "")  # type: ignore[arg-type]
        title = self._extract_chapter_title(soup, chapter_url, story_title or None) or "Chapter"

        content = soup.select_one(_CONTENT_SELECTORS)
        if content is None:
            raise ValueError("Could not detect chapter content for this page")

        for sel in ["script", "style", "nav", "noscript", ".sharedaddy", ".jp-relatedposts"]:
            for el in content.select(sel):
                el.decompose()
        for a in content.select("a[rel='next'], a[rel='prev']"):
            a.decompose()
        for a in content.find_all("a"):
            txt = (a.get_text() or "").lower()
            if (
                "next chapter" in txt
                or "previous chapter" in txt
                or txt.startswith("next ")
                or txt.startswith("previous ")
            ):
                a.decompose()

        html_content = f"<div>{content.decode_contents()}</div>"
        return ChapterContent(
            chapter_number=0,
            title=title,
            html_content=html_content,
            word_count=count_words(html_content),
        )


_instance = SequentialNextLinkAdapter()


def get_adapter() -> SequentialNextLinkAdapter:
    return _instance
