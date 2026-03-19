from __future__ import annotations

from .base import ScraperAdapter
from .novelfire import NovelFireAdapter
from .royalroad import RoyalRoadAdapter
from .sequential import SequentialNextLinkAdapter
from .wanderinginn import WanderingInnAdapter
from .wordpress import WordpressAdapter

# Order matters: more specific adapters first, generic fallbacks last
_ADAPTERS: list[ScraperAdapter] = [
    RoyalRoadAdapter(),
    NovelFireAdapter(),
    WanderingInnAdapter(),
    WordpressAdapter(),
    SequentialNextLinkAdapter(),
]


def get_adapter(url: str) -> ScraperAdapter | None:
    """Return the first adapter that claims it can handle the given URL."""
    for adapter in _ADAPTERS:
        if adapter.can_handle(url):
            return adapter
    return None


def source_name(url: str) -> str | None:
    """Return the adapter name for a URL, or None if unsupported."""
    adapter = get_adapter(url)
    return adapter.name if adapter else None
