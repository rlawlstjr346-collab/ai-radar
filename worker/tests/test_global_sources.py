"""6개 권역 확장: AI 키워드 필터, 상대 링크 보정, X 무과금 oEmbed 수집기 (네트워크 없이 MockTransport)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.rss import RSSAdapter, ai_relevant  # noqa: E402
from adapters.x_oembed import XOEmbedAdapter, extract_status_links, tweet_text_from_oembed  # noqa: E402
from collector.models import SourceConfig  # noqa: E402
from pipeline.store import load_seed_platform_names, load_seed_sources  # noqa: E402


def src(endpoint: str, platform: str = "x", method: str = "api", category: str = "social") -> SourceConfig:
    return SourceConfig(id="t", platform_id=platform, name="t", endpoint=endpoint, method=method, default_category=category)


def rss(items: str, link: str = "https://example.com/") -> bytes:
    return f"""<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>{link}</link>{items}</channel></rss>""".encode()


def entry(title: str, link: str, desc: str = "") -> str:
    return f"<item><title>{title}</title><link>{link}</link><description>{desc}</description><pubDate>{_now()}</pubDate></item>"


def _now() -> str:
    from email.utils import format_datetime
    from datetime import datetime, timezone
    return format_datetime(datetime.now(timezone.utc))


# ── 시드: 권역·소스 확장 ───────────────────────────────────────────────────────
def test_every_new_source_points_to_a_seeded_platform():
    names = load_seed_platform_names()
    sources = load_seed_sources()
    assert len(sources) >= 55
    assert all(s.platform_id in names for s in sources)
    assert len({(s.platform_id, s.name) for s in sources}) == len(sources)       # (platform, name) 유일


# ── AI 키워드 필터 ────────────────────────────────────────────────────────────
def test_ai_relevant_keeps_ai_posts_in_korean_japanese_chinese_and_drops_others():
    for t in ("망분리 환경의 Agent Platform 설계기", "TASTE, 토스의 추천 파운데이션 플랫폼", "生成AIの導入事例",
              "大模型推理加速", "KV 캐시 오프로딩으로 LLM 추론 비용 줄이기"):
        assert ai_relevant(t), t
    for t in ("신입 개발자 온보딩 회고", "GPU 서버 증설 공지", "MAIL server migration", "AIR 배포 자동화"):
        assert not ai_relevant(t), t


def test_company_blog_feed_keeps_only_ai_articles():
    body = rss(entry("TASTE, 토스의 추천 파운데이션 플랫폼", "https://toss.tech/article/taste")
               + entry("사내 해커톤 회고", "https://toss.tech/article/hackathon"))
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    items = RSSAdapter(src("https://toss.tech/rss.xml", "toss-tech", "rss", "dev"), client).fetch()
    assert [i.title for i in items] == ["TASTE, 토스의 추천 파운데이션 플랫폼"]
    assert items[0].engagement == 90.0                                           # 커뮤니티·사내 블로그 가중치


def test_relative_feed_links_become_absolute():
    body = rss(entry("JFinBench: 日本語金融ベンチマーク", "/jfinbench/"), link="https://sakana.ai/")
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    items = RSSAdapter(src("https://sakana.ai/feed.xml", "sakana-ai", "rss", "research"), client).fetch()
    assert items[0].url == "https://sakana.ai/jfinbench/"


# ── X 무과금 수집기 ───────────────────────────────────────────────────────────
def test_extract_status_links_normalizes_and_dedupes():
    text = ("see https://twitter.com/MistralAI/status/2122713540666806397 and "
            "https://x.com/MistralAI/status/2122713540666806397?s=20 plus https://x.com/i/status/123456789")
    assert extract_status_links(text) == [
        ("https://x.com/MistralAI/status/2122713540666806397", "MistralAI", "2122713540666806397")]


def test_oembed_html_to_text():
    html = ('<blockquote class="twitter-tweet"><p lang="en">Gemini 4 Neon is now available &amp; fast</p>'
            '&mdash; Cursor (@cursor_ai) <a href="https://x.com/cursor_ai/status/1">November 18, 2026</a></blockquote>')
    assert tweet_text_from_oembed(html) == "Gemini 4 Neon is now available & fast"


def test_x_adapter_discovers_links_then_reads_tweets_via_oembed_and_skips_non_ai():
    discovery = rss(entry("AINews", "https://latent.space/p/x",
                          "https://x.com/cursor_ai/status/111111111 https://x.com/NTSB/status/222222222 "
                          "https://x.com/bot/status/333333333"))
    tweets = {
        "111111111": "<blockquote><p>Gemini 4 Neon is now available in Cursor at $3/M input tokens</p>"
                     '<a href="x">November 18, 2026</a></blockquote>',
        "222222222": "<blockquote><p>Investigators recovered the cockpit voice recorder.</p></blockquote>",
        "333333333": "<blockquote><p>https://t.co/abc</p></blockquote>",
    }
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(str(req.url))
        if req.url.host == "publish.twitter.com":
            status_url = parse_qs(urlsplit(str(req.url)).query)["url"][0]
            sid = status_url.rsplit("/", 1)[-1]
            return httpx.Response(200, json={"html": tweets[sid], "author_name": "Someone"})
        return httpx.Response(200, content=discovery)

    cfg = {"max_tweets": 10, "require_ai": True,
           "discovery_feeds": [{"name": "Latent Space", "url": "https://latent.space/feed"},
                               {"name": "broken", "url": "https://broken.example/feed"}]}

    def routed(req):
        if req.url.host == "broken.example":
            return httpx.Response(429)
        return handler(req)

    client = httpx.Client(transport=httpx.MockTransport(routed))
    ad = XOEmbedAdapter(src("https://publish.twitter.com/oembed"), client, config=cfg)
    items = ad.fetch()
    assert [i.url for i in items] == ["https://x.com/cursor_ai/status/111111111"]   # 비 AI·링크뿐인 트윗 제외
    assert items[0].category == "social" and items[0].title.startswith("@cursor_ai: Gemini 4 Neon")
    assert items[0].published_at is not None and items[0].published_at.day == 18
    assert any("broken" in s for s in ad.skipped)                                     # 실패한 피드는 격리
    assert all("api.twitter.com" not in c and "api.x.com" not in c for c in calls)    # 유료 API 호출 없음


def test_x_discovery_config_is_valid_json_with_public_feeds():
    cfg = json.loads((Path(__file__).resolve().parents[1] / "config" / "x_discovery.json").read_text(encoding="utf-8"))
    assert cfg["discovery_feeds"] and all(f["url"].startswith("https://") for f in cfg["discovery_feeds"])
