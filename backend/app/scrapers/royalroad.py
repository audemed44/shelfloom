from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag

from .base import (
    ChapterContent,
    ChapterInfo,
    SerialMetadata,
    build_client,
    count_words,
    normalize_chapter_list,
    rate_limited_sleep,
    strip_html_entities,
)


class RoyalRoadAdapter:
    name = "royalroad"

    def can_handle(self, url: str) -> bool:
        host = urlparse(url).hostname or ""
        host = host.removeprefix("www.")
        return host in ("royalroad.com", "royalroadl.com")

    def _story_url(self, url: str) -> str:
        parsed = urlparse(url)
        parts = [p for p in parsed.path.split("/") if p]
        try:
            idx = parts.index("fiction")
            if len(parts) >= idx + 2:
                slug = parts[idx + 2] if len(parts) > idx + 2 else ""
                path = f"/fiction/{parts[idx + 1]}/{slug}".rstrip("/")
                return f"{parsed.scheme}://{parsed.netloc}{path}"
        except ValueError:
            pass
        return url.rstrip("/")

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        story_url = self._story_url(url)
        async with build_client() as client:
            resp = await client.get(story_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("div.fic-header div.col h1") or soup.find("h1")
        title = strip_html_entities(title_el.get_text() if title_el else "") or "Untitled"

        author_el = soup.select_one("div.fic-header h4 span a")
        author = strip_html_entities(author_el.get_text() if author_el else "") or None

        desc_el = soup.select_one("div.fiction-info div.description")
        description = strip_html_entities(desc_el.get_text() if desc_el else "") or None

        cover_el = soup.select_one("img.thumbnail")
        cover_url = cover_el.get("src") if cover_el else None  # type: ignore[union-attr]

        return SerialMetadata(
            title=title,
            author=author,
            description=description,
            cover_url=str(cover_url) if cover_url else None,
            status="ongoing",
        )

    async def fetch_chapter_list(self, url: str) -> list[ChapterInfo]:
        from datetime import datetime

        story_url = self._story_url(url)
        async with build_client() as client:
            resp = await client.get(story_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        links: list[tuple[str | None, str, datetime | None]] = []
        for row in soup.select("table#chapters tr"):
            link_el = row.select_one("a[href*='/chapter/']")
            if not link_el:
                continue
            href = link_el.get("href")  # type: ignore[union-attr]
            text = strip_html_entities(link_el.get_text())
            publish_date: datetime | None = None
            time_el = row.select_one("time[datetime]")
            if time_el:
                try:
                    dt_str = time_el["datetime"]
                    publish_date = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00"))
                except (ValueError, KeyError):
                    pass
            links.append((str(href) if href else None, text, publish_date))

        return normalize_chapter_list(story_url, links)

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.find("h1") or soup.find("h2")
        title = strip_html_entities(title_el.get_text() if title_el else "") or "Chapter"

        self._preprocess_raw_dom(soup)

        container = None
        for portlet in soup.select("div.portlet-body"):
            if portlet.select_one("div.chapter-inner"):
                container = portlet
                break
        if container is None:
            container = soup.select_one(".page-content-wrapper")

        if container is None:
            container = soup.new_tag("div")

        for sel in ["script", "style", "nav", ".btn", ".chapter-nav"]:
            for el in container.select(sel):
                el.decompose()

        for a in container.select("a[href*='royalroadl.com'], a[href*='royalroad.com']"):
            txt = (a.get_text() or "").lower()
            if "next" in txt or "previous" in txt:
                a.decompose()

        self._remove_advertisement_blocks(container)
        self._keep_only_wanted_top_level(container)
        self._remove_problematic_inline_styles(container)

        html_content = f"<div>{container.decode_contents()}</div>"
        return ChapterContent(
            chapter_number=0,  # filled in by caller
            title=title,
            html_content=html_content,
            word_count=count_words(html_content),
        )

    def _preprocess_raw_dom(self, soup: BeautifulSoup) -> None:
        for img in soup.find_all("img"):
            if not (img.get("src") or "").strip():
                img.decompose()

        css_class_pattern = re.compile(r"^cn[A-Z][A-Za-z0-9]{41}$")
        for p in soup.find_all("p"):
            classes = p.get("class") or []
            kept = [c for c in classes if not css_class_pattern.match(c)]
            if not kept:
                del p["class"]
            else:
                p["class"] = kept

    def _remove_advertisement_blocks(self, container: Tag) -> None:
        for portlet in container.select("div.portlet"):
            text = portlet.get_text().strip().lower()
            has_ad_id = bool(portlet.select("[id^='Chapter_'], [id^='chapter_']"))
            if text == "advertisement" or text.startswith("advertisement") or has_ad_id:
                prev = portlet.find_previous_sibling()
                if prev and prev.name == "hr":
                    prev.decompose()
                next_el = portlet.find_next_sibling()
                if next_el and next_el.name == "hr":
                    next_el.decompose()
                portlet.decompose()

    def _keep_only_wanted_top_level(self, container: Tag) -> None:
        for child in list(container.children):
            if not isinstance(child, Tag):
                continue
            tag = child.name or ""
            classes = " ".join(child.get("class") or [])
            wanted = tag == "h1" or (
                tag == "div"
                and (
                    classes.startswith("chapter-inner")
                    or "author-note-portlet" in classes
                    or "page-content" in classes
                )
            )
            if not wanted:
                child.decompose()

    def _remove_problematic_inline_styles(self, container: Tag) -> None:
        for el in container.select("[style]"):
            style = el.get("style") or ""
            style = re.sub(
                r"border(-left|-right|-inline-start|-inline-end)?\s*:[^;]+;?",
                "",
                style,
                flags=re.IGNORECASE,
            )
            style = re.sub(r"outline\s*:[^;]+;?", "", style, flags=re.IGNORECASE)
            style = re.sub(r"box-shadow\s*:[^;]+;?", "", style, flags=re.IGNORECASE)
            style = re.sub(r"\s{2,}", " ", style).strip()
            if style:
                el["style"] = style
            else:
                del el["style"]


_instance = RoyalRoadAdapter()


def get_adapter() -> RoyalRoadAdapter:
    return _instance
