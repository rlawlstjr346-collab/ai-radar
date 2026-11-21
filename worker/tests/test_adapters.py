"""어댑터 단위 테스트 — httpx.MockTransport 로 네트워크 없이."""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapters import resolve_adapter  # noqa: E402
from adapters.anthropic_sitemap import AnthropicSitemapAdapter, title_from_slug  # noqa: E402
from adapters.bluesky import BlueskyAdapter  # noqa: E402
from adapters.civitai import CivitaiAdapter, UnsafeEndpointError, is_safe_model  # noqa: E402
from adapters.hacker_news import HackerNewsAdapter  # noqa: E402
from adapters.huggingface import HFDailyPapersAdapter, HFTrendingSpacesAdapter  # noqa: E402
from adapters.rss import RSSAdapter  # noqa: E402
from collector.models import SourceConfig  # noqa: E402
from pipeline.store import load_seed_sources  # noqa: E402

NOW = datetime.now(timezone.utc)
ISO = lambda dt: dt.isoformat().replace("+00:00", "Z")  # noqa: E731


def src(endpoint, platform="x", method="api", category="dev", name="S"):
    return SourceConfig(id="sid", platform_id=platform, name=name, endpoint=endpoint, method=method,
                        default_category=category)


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


# ── registry ────────────────────────────────────────────────────────────────
def test_every_seed_source_resolves_to_expected_adapter():
    expected = {
        "HF Daily Papers": "HFDailyPapersAdapter", "HF Trending Models": "HFTrendingModelsAdapter",
        "HF Trending Spaces": "HFTrendingSpacesAdapter", "OpenAI News": "RSSAdapter",
        "Anthropic News": "AnthropicSitemapAdapter", "Google DeepMind Blog": "RSSAdapter",
        "HN AI Stories": "HackerNewsAdapter", "Ollama Releases": "RSSAdapter", "vLLM Releases": "RSSAdapter",
        "Transformers Releases": "RSSAdapter", "ComfyUI Releases": "RSSAdapter",
        "Civitai Top Models (SFW)": "CivitaiAdapter", "Bluesky AI Researchers List": "BlueskyAdapter",
    }
    sources = load_seed_sources()
    # 기본 13개 + 6개 권역 글로벌 확장 47개 (seed_platforms_v2_global.sql)
    assert len(sources) == 60
    assert [s.name for s in sources[:13]] == list(expected)          # 기존 13개는 그대로, 같은 순서
    with httpx.Client() as c:
        for s in sources:
            want = expected.get(s.name) or ("XOEmbedAdapter" if "publish.twitter.com" in s.endpoint else "RSSAdapter")
            assert type(resolve_adapter(s, c)).__name__ == want, s.name


# ── Civitai 안전 필터 ─────────────────────────────────────────────────────────
CIVITAI_EP = "https://civitai.com/api/v1/models?limit=20&sort=Highest%20Rated&period=Week&nsfw=false"


def civ_model(mid, name, level, nsfw=False, img_levels=(1,), **extra):
    return {"id": mid, "name": name, "type": "LORA", "nsfw": nsfw, "nsfwLevel": level, "tags": ["style"],
            "stats": {"downloadCount": 10, "thumbsUpCount": 200},
            "modelVersions": [{"nsfwLevel": level, "baseModel": "SDXL",
                               "publishedAt": ISO(NOW),
                               "images": [{"nsfwLevel": lv, "type": "image", "url": f"https://img/{mid}/{lv}"}
                                          for lv in img_levels]}], **extra}


def test_civitai_refuses_endpoint_without_nsfw_false():
    for ep in ("https://civitai.com/api/v1/models?limit=20", "https://civitai.com/api/v1/models?nsfw=true"):
        a = CivitaiAdapter(src(ep, "civitai"), client_for(lambda r: httpx.Response(200, json={"items": []})))
        with pytest.raises(UnsafeEndpointError):
            a.fetch()


def test_civitai_forces_nsfw_false_on_request_and_filters_unsafe_models():
    seen = {}

    def handler(request):
        seen["query"] = parse_qs(urlsplit(str(request.url)).query)
        return httpx.Response(200, json={"items": [
            civ_model(1, "Watercolor Style", 1),
            civ_model(2, "Anime Lines", 3, img_levels=(2, 1)),
            civ_model(3, "Mixed Bag", 31),                       # R/X 비트 포함 → 제외
            civ_model(4, "Explicit", 1, nsfw=True),              # nsfw True → 제외
            civ_model(5, "Celebrity Face", 1, poi=True),         # 실존 인물 → 제외
            civ_model(6, "Lingerie Pack", 1),                    # 금칙어 → 제외
            civ_model(7, "Night City", 4),                       # R → 제외
            {**civ_model(8, "No Flag", 1), "nsfw": None},        # nsfw 미표기 → 제외
        ]})

    items = CivitaiAdapter(src(CIVITAI_EP, "civitai", category="image_design"), client_for(handler)).fetch()
    assert seen["query"]["nsfw"] == ["false"]
    assert [i.url for i in items] == ["https://civitai.com/models/1", "https://civitai.com/models/2"]
    # 썸네일은 PG(1) 이미지만
    assert items[0].thumbnail_url == "https://img/1/1"
    assert items[1].thumbnail_url == "https://img/2/1"
    assert all(i.category == "image_design" for i in items)


def test_civitai_no_pg_image_means_no_thumbnail():
    assert is_safe_model(civ_model(9, "Clean", 2, img_levels=(2,)))
    items = CivitaiAdapter(src(CIVITAI_EP, "civitai"), client_for(
        lambda r: httpx.Response(200, json={"items": [civ_model(9, "Clean", 2, img_levels=(2,))]}))).fetch()
    assert items[0].thumbnail_url is None


# ── Hugging Face ────────────────────────────────────────────────────────────
def test_hf_papers_maps_to_arxiv_url():
    payload = [{"paper": {"id": "2611.00001", "title": "T", "summary": "<p>Abs</p>", "upvotes": 10,
                          "publishedAt": ISO(NOW)}, "thumbnail": "https://t", "numComments": 2}]
    items = HFDailyPapersAdapter(src("https://huggingface.co/api/daily_papers", "huggingface", category="research"),
                                 client_for(lambda r: httpx.Response(200, json=payload))).fetch()
    assert items[0].url == "https://arxiv.org/abs/2611.00001"
    assert items[0].engagement == 40 and items[0].body == "Abs"


def test_hf_spaces_keeps_only_creative_and_requests_carddata():
    seen = {}

    def handler(request):
        seen["query"] = parse_qs(urlsplit(str(request.url)).query)
        return httpx.Response(200, json=[
            {"id": "a/music-gen", "cardData": {"title": "Music Gen", "short_description": "make a song"},
             "likes": 5, "trendingScore": 10, "createdAt": ISO(NOW)},
            {"id": "b/leaderboard", "cardData": {"title": "LLM Leaderboard", "short_description": "rankings"},
             "likes": 5, "trendingScore": 50, "createdAt": ISO(NOW)},
        ])

    items = HFTrendingSpacesAdapter(src("https://huggingface.co/api/spaces?sort=trendingScore&limit=50",
                                        "huggingface", category="image_design"), client_for(handler)).fetch()
    assert "cardData" in seen["query"]["expand[]"] and seen["query"]["sort"] == ["trendingScore"]
    assert [i.url for i in items] == ["https://huggingface.co/spaces/a/music-gen"]


# ── Hacker News ─────────────────────────────────────────────────────────────
def test_hn_keeps_point_filter_adds_time_window_and_requires_ai_title():
    queries = []

    def handler(request):
        q = parse_qs(urlsplit(str(request.url)).query)
        queries.append(q)
        return httpx.Response(200, json={"hits": [
            {"objectID": "1", "title": "New LLM beats benchmarks", "url": "https://ex.com/a", "points": 300,
             "num_comments": 10, "created_at": ISO(NOW)},
            {"objectID": "2", "title": "Said the gardener", "url": "https://ex.com/b", "points": 500,
             "created_at": ISO(NOW)},
        ]})

    ep = "https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E%3D100"
    items = HackerNewsAdapter(src(ep, "hacker-news"), client_for(handler)).fetch()
    nf = queries[0]["numericFilters"][0]
    assert "points>=100" in nf and "created_at_i>" in nf
    assert [i.title for i in items] == ["New LLM beats benchmarks"]      # 쿼리 여러 번이어도 중복 없음
    assert items[0].engagement == 300


# ── RSS / GitHub releases ───────────────────────────────────────────────────
def atom(entries):
    body = "".join(
        f"<entry><title>{t}</title><link href='{l}'/><updated>{u}</updated><content type='html'>&lt;p&gt;notes&lt;/p&gt;</content></entry>"
        for t, l, u in entries)
    return f"<?xml version='1.0'?><feed xmlns='http://www.w3.org/2005/Atom'><title>x</title>{body}</feed>"


def test_github_release_feed_skips_prereleases_and_old_entries():
    ep = "https://github.com/ollama/ollama/releases.atom"
    xml = atom([
        ("v0.6.0", "https://github.com/ollama/ollama/releases/tag/v0.6.0", ISO(NOW)),
        ("v0.6.1-rc1", "https://github.com/ollama/ollama/releases/tag/v0.6.1-rc1", ISO(NOW)),
        ("v0.1.0", "https://github.com/ollama/ollama/releases/tag/v0.1.0", ISO(NOW - timedelta(days=60))),
    ])
    items = RSSAdapter(src(ep, "ollama", method="rss"), client_for(lambda r: httpx.Response(200, text=xml))).fetch()
    assert [i.title for i in items] == ["ollama v0.6.0"]
    assert items[0].body == "notes"


# ── Anthropic sitemap ───────────────────────────────────────────────────────
def test_anthropic_sitemap_only_recent_news_and_research():
    rows = [
        ("https://www.anthropic.com/news/claude-new-feature", NOW),
        ("https://www.anthropic.com/research/ai-safety-paper", NOW - timedelta(days=1)),
        ("https://www.anthropic.com/careers", NOW),
        ("https://www.anthropic.com/news/very-old-post", NOW - timedelta(days=30)),
    ]
    xml = ("<?xml version='1.0'?><urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>"
           + "".join(f"<url><loc>{u}</loc><lastmod>{ISO(d)}</lastmod></url>" for u, d in rows) + "</urlset>")
    items = AnthropicSitemapAdapter(src("https://www.anthropic.com/sitemap.xml", "anthropic", method="rss"),
                                    client_for(lambda r: httpx.Response(200, text=xml))).fetch()
    assert [i.url for i in items] == ["https://www.anthropic.com/news/claude-new-feature",
                                      "https://www.anthropic.com/research/ai-safety-paper"]
    assert items[1].title == "Anthropic Research: AI Safety Paper"
    assert title_from_slug("81k-economics") == "81k Economics"


# ── Bluesky ─────────────────────────────────────────────────────────────────
def bsky_post(rkey, text, likes, created, external=None, reason=None, reply=False):
    post = {"uri": f"at://did:plc:x/app.bsky.feed.post/{rkey}", "author": {"handle": "alice.bsky.social"},
            "record": {"text": text, "createdAt": ISO(created), **({"reply": {}} if reply else {})},
            "likeCount": likes, "repostCount": 2}
    if external:
        post["embed"] = {"external": external}
    entry = {"post": post}
    if reason:
        entry["reason"] = reason
    return entry


def test_bluesky_iterates_handles_and_skips_failures():
    calls = []

    def handler(request):
        actor = parse_qs(urlsplit(str(request.url)).query)["actor"][0]
        calls.append((request.url.path, actor))
        if actor == "missing.example":
            return httpx.Response(400, json={"error": "InvalidRequest"})
        return httpx.Response(200, json={"feed": [
            bsky_post("p1", "New paper on long context\nmore", 50, NOW,
                      external={"uri": "https://arxiv.org/abs/2611.00001v1", "title": "Paper", "description": "d"}),
            bsky_post("p2", "low likes", 1, NOW),
            bsky_post("p3", "old", 99, NOW - timedelta(days=10)),
            bsky_post("p4", "repost", 99, NOW, reason={"$type": "reasonRepost"}),
            bsky_post("p5", "reply", 99, NOW, reply=True),
            bsky_post("p6", "Plain post about agents", 30, NOW),
        ]})

    config = {"handles": ["alice.bsky.social", "missing.example"], "lookback_hours": 72, "min_likes": 15}
    old_ep = "https://public.api.bsky.app/xrpc/app.bsky.feed.getListFeed?list={LIST_AT_URI}"
    adapter = BlueskyAdapter(src(old_ep, "bluesky", category="social"), client_for(handler), config=config)
    items = adapter.fetch()

    assert all(path == "/xrpc/app.bsky.feed.getAuthorFeed" for path, _ in calls)
    assert [a for _, a in calls] == ["alice.bsky.social", "missing.example"]
    assert adapter.skipped == ["missing.example: HTTPStatusError"]
    assert [i.url for i in items] == ["https://arxiv.org/abs/2611.00001v1",
                                      "https://bsky.app/profile/alice.bsky.social/post/p6"]
    assert items[0].title == "New paper on long context"
    assert items[0].metrics["post_url"].endswith("/p1")


def test_bluesky_config_file_has_handles():
    cfg = json.loads((Path(__file__).resolve().parent.parent / "config" / "bluesky_accounts.json").read_text("utf-8"))
    assert {"huggingface.bsky.social", "simonwillison.net", "karpathy.bsky.social", "ollama.com"} <= set(cfg["handles"])


def test_time_module_sanity():
    assert time.time() > 0
