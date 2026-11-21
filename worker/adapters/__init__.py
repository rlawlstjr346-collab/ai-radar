"""어댑터 레지스트리 — sources.endpoint 로 담당 어댑터를 찾는다 (DB 컬럼 추가 없이)."""

from __future__ import annotations

import httpx

from adapters.anthropic_sitemap import AnthropicSitemapAdapter
from adapters.base import BaseAdapter, FeedGuard
from adapters.bluesky import BlueskyAdapter
from adapters.civitai import CivitaiAdapter
from adapters.hacker_news import HackerNewsAdapter
from adapters.huggingface import HFDailyPapersAdapter, HFTrendingModelsAdapter, HFTrendingSpacesAdapter
from adapters.rss import RSSAdapter
from adapters.x_oembed import XOEmbedAdapter
from collector.models import SourceConfig

# 순서 중요: 구체적인 것 먼저, RSSAdapter(method='rss' 전체)는 마지막 fallback
REGISTRY: tuple[type[BaseAdapter], ...] = (
    HFDailyPapersAdapter,
    HFTrendingModelsAdapter,
    HFTrendingSpacesAdapter,
    HackerNewsAdapter,
    CivitaiAdapter,
    BlueskyAdapter,
    AnthropicSitemapAdapter,
    XOEmbedAdapter,
    RSSAdapter,
)


class NoAdapterError(LookupError):
    pass


def resolve_adapter(source: SourceConfig, client: httpx.Client, guard: FeedGuard | None = None) -> BaseAdapter:
    for cls in REGISTRY:
        if cls.matches(source):
            return cls(source, client, guard=guard)
    raise NoAdapterError(f"no adapter for source '{source.name}' ({source.endpoint})")
