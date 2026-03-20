from __future__ import annotations

from .base import ScraperAdapter
from .novelfire import NovelFireAdapter
from .royalroad import RoyalRoadAdapter
from .sequential import SequentialNextLinkAdapter
from .wanderinginn import WanderingInnAdapter
from .wildbow import WildbowAdapter
from .wordpress import WordpressAdapter

# Order matters: more specific adapters first, generic fallbacks last
_ADAPTERS: list[ScraperAdapter] = [
    RoyalRoadAdapter(),
    NovelFireAdapter(),
    WanderingInnAdapter(),
    WildbowAdapter(),
    WordpressAdapter(),
    SequentialNextLinkAdapter(),
]


def get_adapter(url: str) -> ScraperAdapter | None:
    """Return the first adapter that claims it can handle the given URL."""
    for adapter in _ADAPTERS:
        if adapter.can_handle(url):
            return adapter
    return None


def get_adapter_by_name(name: str) -> ScraperAdapter | None:
    """Return the adapter with the given name, or None."""
    for adapter in _ADAPTERS:
        if adapter.name == name:
            return adapter
    return None


def list_adapter_names() -> list[str]:
    """Return the names of all registered adapters."""
    return [a.name for a in _ADAPTERS]


def source_name(url: str) -> str | None:
    """Return the adapter name for a URL, or None if unsupported."""
    adapter = get_adapter(url)
    return adapter.name if adapter else None
