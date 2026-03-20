from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

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


class NovelFireAdapter:
    name = "novelfire"

    def can_handle(self, url: str) -> bool:
        host = urlparse(url).hostname or ""
        return host.removeprefix("www.") == "novelfire.net"

    def _story_root(self, url: str) -> str:
        if url.endswith("/chapters"):
            return url[:-9]
        return url.rstrip("/")

    async def fetch_metadata(self, url: str) -> SerialMetadata:
        root = self._story_root(url)
        chapter_listing_url = f"{root}/chapters"
        async with build_client() as client:
            resp = await client.get(chapter_listing_url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("div.novel-info h1") or soup.find("h1")
        title = strip_html_entities(title_el.get_text() if title_el else "") or "Untitled"

        author_el = soup.select_one("span[itemprop='author']")
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
        root = self._story_root(url)
        chapter_listing_url = f"{root}/chapters"

        async with build_client() as client:
            resp = await client.get(chapter_listing_url)
            resp.raise_for_status()
            html_text = resp.text

        soup = BeautifulSoup(html_text, "html.parser")

        ajax_endpoint = self._extract_ajax_endpoint(html_text, chapter_listing_url)
        html_chapters = await self._fetch_all_html_chapters(chapter_listing_url, root, soup)

        if ajax_endpoint:
            async with build_client() as client:
                ajax_chapters = await self._fetch_all_ajax_chapters(client, ajax_endpoint, root)
            chapters = ajax_chapters if len(ajax_chapters) >= len(html_chapters) else html_chapters
        else:
            chapters = html_chapters

        return chapters

    async def _fetch_all_ajax_chapters(
        self, client: httpx.AsyncClient, ajax_endpoint: str, root: str
    ) -> list[ChapterInfo]:

        page_size = 100
        start = 0
        chapter_data: list[dict] = []
        seen: set[str] = set()

        while True:
            page_url = (
                f"{ajax_endpoint}&draw=1&start={start}&length={page_size}"
                "&order%5B0%5D%5Bcolumn%5D=2&order%5B0%5D%5Bdir%5D=asc"
            )
            try:
                resp = await client.get(page_url)  # type: ignore[union-attr]
                resp.raise_for_status()
                payload = resp.json()
            except Exception:
                break

            page = payload.get("data", []) if isinstance(payload, dict) else []
            if not page:
                break

            for row in page:
                key = str(row.get("n_sort") or row.get("title") or id(row))
                if key not in seen:
                    seen.add(key)
                    chapter_data.append(row)

            records_total = int(payload.get("recordsTotal") or payload.get("recordsFiltered") or 0)
            if records_total > 0:
                if len(chapter_data) >= records_total:
                    break
            elif len(page) < page_size:
                break
            start += page_size

        result: list[ChapterInfo] = []
        for idx, row in enumerate(chapter_data):
            result.append(
                ChapterInfo(
                    chapter_number=idx + 1,
                    title=strip_html_entities(row.get("title", "")),
                    source_url=f"{root}/chapter-{row.get('n_sort', idx + 1)}",
                    publish_date=None,
                )
            )
        return result

    async def _fetch_all_html_chapters(
        self, chapter_listing_url: str, root: str, first_soup: BeautifulSoup
    ) -> list[ChapterInfo]:
        links: list[tuple[str | None, str, None]] = []
        links.extend(self._extract_html_chapter_page(first_soup))

        page_urls = self._extract_toc_page_urls(first_soup, chapter_listing_url)
        async with build_client() as client:
            for page_url in page_urls:
                resp = await client.get(page_url)
                resp.raise_for_status()
                page_soup = BeautifulSoup(resp.text, "html.parser")
                links.extend(self._extract_html_chapter_page(page_soup))
                await rate_limited_sleep()

        return normalize_chapter_list(root, links)

    def _extract_html_chapter_page(self, soup: BeautifulSoup) -> list[tuple[str | None, str, None]]:
        links: list[tuple[str | None, str, None]] = []
        for el in soup.select("ul.chapter-list a"):
            href = el.get("href")
            title_el = el.select_one(".chapter-title")
            text = strip_html_entities((title_el or el).get_text())
            links.append((str(href) if href else None, text, None))
        return links

    def _extract_toc_page_urls(self, soup: BeautifulSoup, chapter_listing_url: str) -> list[str]:
        page_numbers: list[int] = []
        for a in soup.select("ul.pagination li a"):
            href = a.get("href")
            if not href:
                continue
            try:
                from urllib.parse import parse_qs, urljoin, urlparse

                abs_url = urljoin(chapter_listing_url, str(href))
                page = parse_qs(urlparse(abs_url).query).get("page", [None])[0]
                if page and page.isdigit() and int(page) > 1:
                    page_numbers.append(int(page))
            except Exception:
                pass

        if not page_numbers:
            return []

        from urllib.parse import parse_qs, urlencode, urljoin, urlparse

        max_page = max(page_numbers)
        base = urlparse(chapter_listing_url)
        urls: list[str] = []
        for page in range(2, max_page + 1):
            params = parse_qs(base.query)
            params["page"] = [str(page)]
            new_query = urlencode({k: v[0] for k, v in params.items()})
            urls.append(base._replace(query=new_query).geturl())
        return urls

    def _extract_ajax_endpoint(self, html: str, base_url: str) -> str | None:
        marker = "/listChapterDataAjax"
        idx = html.find(marker)
        if idx == -1:
            return None
        fragment_match = re.match(r"(/listChapterDataAjax[^\"']+)", html[idx:])
        if not fragment_match:
            return None
        host_match = re.search(r"https?://([^\"'\s]+)/", html)
        if not host_match:
            return None
        return f"https://{host_match.group(1)}{fragment_match.group(1)}"

    async def fetch_chapter_content(self, chapter_url: str) -> ChapterContent:
        async with build_client() as client:
            resp = await client.get(chapter_url)
            resp.raise_for_status()
        await rate_limited_sleep()

        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("span.chapter-title") or soup.find("h1")
        title = strip_html_entities(title_el.get_text() if title_el else "") or "Chapter"

        content = soup.select_one("div.chapter-content") or soup.select_one("div#content")
        if content is None:
            content = soup.new_tag("div")

        for sel in ["script", "style", ".ads", ".advertisement"]:
            for el in content.select(sel):
                el.decompose()

        self._remove_watermark_paragraphs(content)
        self._remove_nested_strong_tags(content)
        self._remove_dl_info_blocks(content)

        html_content = f"<div>{content.decode_contents()}</div>"
        return ChapterContent(
            chapter_number=0,
            title=title,
            html_content=html_content,
            word_count=count_words(html_content),
        )

    def _remove_watermark_paragraphs(self, content: object) -> None:
        from bs4 import Tag

        assert isinstance(content, Tag)
        for p in content.find_all("p"):
            if p.get("class") or []:
                p.decompose()

    def _remove_nested_strong_tags(self, content: object) -> None:
        from bs4 import Tag

        assert isinstance(content, Tag)
        for strong in content.select("strong strong"):
            parent = strong.parent
            if parent:
                parent.decompose()

    def _remove_dl_info_blocks(self, content: object) -> None:
        from bs4 import Tag

        assert isinstance(content, Tag)
        for dt in content.select("div > dl > dt"):
            dl = dt.parent
            if dl and dl.parent:
                dl.parent.decompose()


_instance = NovelFireAdapter()


def get_adapter() -> NovelFireAdapter:
    return _instance
