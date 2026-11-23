"""X 다중 폴백 실시간 수집기 + GitHub 1시간 주기 핫 AI 수집기 + 웹 고유 큐레이터·기획팀 피드 단위 테스트."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.base import FeedGuard, SourceSkippedError  # noqa: E402
from adapters.github_trending import GitHubHotAIAdapter, is_quality_ai_repo  # noqa: E402
from adapters.x_oembed import XOEmbedAdapter, is_noisy_x_post, parse_syndication_timeline  # noqa: E402
from collector.models import RawItem, SourceConfig  # noqa: E402
from pipeline.curator import is_blocked_noise  # noqa: E402
from pipeline.merge import group_raw_items  # noqa: E402
from pipeline.snapshot import build_and_save_snapshot  # noqa: E402


def _src(endpoint: str, pid: str = "github", name: str = "S") -> SourceConfig:
    return SourceConfig(id=f"s-{pid}", platform_id=pid, name=name, endpoint=endpoint, method="api", default_category="dev")


def test_x_noise_filter_and_syndication_parser():
    assert is_noisy_x_post("RT @openai: something big") is True
    assert is_noisy_x_post("gm") is True
    assert is_noisy_x_post("Follow and retweet for a free AI giveaway!") is True
    assert is_noisy_x_post("https://t.co/abc123") is True
    assert is_noisy_x_post("We just launched v2 of our open-source AI coding agent with MCP support.") is False

    next_data = {
        "props": {
            "pageProps": {
                "timeline": {
                    "entries": [
                        {
                            "content": {
                                "tweet": {
                                    "id_str": "9876543210",
                                    "full_text": "Introducing our new open-source AI web app builder with instant MCP workflows.",
                                    "created_at": "Mon Nov 23 09:00:00 +0000 2026",
                                    "favorite_count": 420,
                                    "retweet_count": 88,
                                    "user": {"screen_name": "vercel", "name": "Vercel"},
                                }
                            }
                        },
                        {
                            "content": {
                                "tweet": {
                                    "id_str": "9876543211",
                                    "full_text": "RT @someone: retweet should be ignored",
                                    "retweeted_status": {"id_str": "1"},
                                }
                            }
                        },
                    ]
                }
            }
        }
    }
    html_doc = f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data)}</script></html>'
    posts = parse_syndication_timeline(html_doc, "vercel")
    assert len(posts) == 1
    assert posts[0]["handle"] == "vercel"
    assert posts[0]["url"] == "https://x.com/vercel/status/9876543210"
    assert posts[0]["engagement"] >= 420


def test_x_adapter_falls_back_to_syndication_when_discovery_empty():
    now = datetime.now(timezone.utc)
    created_str = now.strftime("%a %b %d %H:%M:%S +0000 %Y")
    next_data = {
        "props": {
            "pageProps": {
                "timeline": {
                    "entries": [
                        {
                            "content": {
                                "tweet": {
                                    "id_str": "5555555555",
                                    "full_text": "Launching our open-source AI agent studio for building web apps in minutes.",
                                    "created_at": created_str,
                                    "favorite_count": 300,
                                    "retweet_count": 50,
                                    "user": {"screen_name": "cursor_ai", "name": "Cursor"},
                                }
                            }
                        }
                    ]
                }
            }
        }
    }

    def handler(req: httpx.Request) -> httpx.Response:
        if "syndication.twitter.com" in str(req.url):
            return httpx.Response(200, text=f'<script id="__NEXT_DATA__">{json.dumps(next_data)}</script>')
        return httpx.Response(500)

    cfg = {
        "max_tweets": 10,
        "require_ai": True,
        "lookback_hours": 72,
        "target_accounts": ["cursor_ai"],
        "nitter_instances": [],
        "discovery_feeds": [],
    }
    client = httpx.Client(transport=httpx.MockTransport(handler))
    ad = XOEmbedAdapter(_src("https://publish.twitter.com/oembed", "x"), client, config=cfg)
    items = ad.fetch()
    assert len(items) == 1
    assert items[0].metrics["author_handle"] == "@cursor_ai"
    assert items[0].url == "https://x.com/cursor_ai/status/5555555555"


def test_github_hourly_gate_duplicate_defense_and_empty_skip(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("FORCE_GITHUB_COLLECT", raising=False)
    meta_path = tmp_path / "live-feed-meta.json"
    clock = [datetime(2026, 11, 23, 10, 0, 0, tzinfo=timezone.utc)]
    created_iso = (clock[0] - timedelta(hours=10)).isoformat().replace("+00:00", "Z")
    rel_iso = (clock[0] - timedelta(hours=4)).isoformat().replace("+00:00", "Z")

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "/search/repositories" in u:
            return httpx.Response(200, json={
                "items": [
                    {
                        "full_name": "builder/ai-agent-studio",
                        "html_url": "https://github.com/builder/ai-agent-studio",
                        "description": "Open-source AI agent web app builder with MCP support",
                        "stargazers_count": 120,
                        "created_at": created_iso,
                        "language": "TypeScript",
                        "license": {"spdx_id": "MIT"},
                        "topics": ["ai", "agent", "mcp"],
                        "fork": False,
                    },
                    {
                        "full_name": "spam/awesome-ai-links",
                        "html_url": "https://github.com/spam/awesome-ai-links",
                        "description": "Awesome curated list of AI links",
                        "stargazers_count": 300,
                        "created_at": created_iso,
                        "fork": False,
                    },
                ]
            })
        if "/repos/vercel/ai/releases/latest" in u:
            return httpx.Response(200, json={
                "tag_name": "v5.2.0",
                "name": "v5.2.0",
                "html_url": "https://github.com/vercel/ai/releases/tag/v5.2.0",
                "published_at": rel_iso,
                "body": "Added native MCP tool streaming and agent workflows.",
                "draft": False,
                "prerelease": False,
            })
        return httpx.Response(404)

    guard = FeedGuard(meta_path, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    client = httpx.Client(transport=httpx.MockTransport(handler))
    ep = "https://api.github.com/search/repositories?ai_radar_hot=1"

    # 1차 실행: 급상승 AI 레포 1건 + vercel/ai 신규 릴리즈 1건 수집 (awesome-list 는 자동 차단)
    ad1 = GitHubHotAIAdapter(_src(ep), client, guard=guard, now_fn=lambda: clock[0])
    items1 = ad1.fetch()
    guard.save()
    assert len(items1) == 2
    assert any(i.url == "https://github.com/builder/ai-agent-studio" for i in items1)
    assert any(i.url == "https://github.com/vercel/ai/releases/tag/v5.2.0" for i in items1)

    # 2차 실행 (20분 뒤): 60분 미만 → 1시간 게이트로 즉시 스킵
    clock[0] = clock[0] + timedelta(minutes=20)
    guard2 = FeedGuard(meta_path, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    ad2 = GitHubHotAIAdapter(_src(ep), client, guard=guard2, now_fn=lambda: clock[0])
    with pytest.raises(SourceSkippedError):
        ad2.fetch()

    # 3차 실행 (65분 뒤): 이미 수집한 레포·릴리즈는 중복 차단 → 0건 깔끔 스킵 (저품질 억지 채우기 없음)
    clock[0] = clock[0] + timedelta(minutes=45)
    guard3 = FeedGuard(meta_path, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    ad3 = GitHubHotAIAdapter(_src(ep), client, guard=guard3, now_fn=lambda: clock[0])
    items3 = ad3.fetch()
    assert items3 == []
    assert any("0 qualified" in s for s in ad3.skipped)


def test_is_quality_ai_repo_filters_junk():
    assert is_quality_ai_repo({"full_name": "a/b", "description": "short", "fork": False}) is False
    assert is_quality_ai_repo({"full_name": "a/awesome-llm", "description": "A curated list of LLM tools", "fork": False}) is False
    assert is_quality_ai_repo({"full_name": "spam/capcut-seedance-win", "description": "CapCut AI video generator", "language": None, "fork": False}) is False
    assert is_quality_ai_repo({"full_name": "bot/fake-ai-app", "description": "AI web app builder", "language": "Python", "stargazers_count": 200, "forks_count": 0, "fork": False}) is False
    assert is_quality_ai_repo({"full_name": "a/mcp-agent", "description": "Autonomous MCP coding agent for web apps", "language": "TypeScript", "stargazers_count": 120, "forks_count": 14, "fork": False}) is True


def test_curator_blocks_noise_eliminates_robotic_text_and_writes_planning_feed(tmp_path: Path):
    assert is_blocked_noise("[독서 모임 모집] AI 논문 함께 읽기 3기") is True
    assert is_blocked_noise("AI 엔지니어 개발자 채용 공고") is True
    assert is_blocked_noise("클로드 코드 MCP 워크플로 실전 가이드") is False

    now = datetime(2026, 11, 23, 10, 0, 0, tzinfo=timezone.utc)
    snap_path = tmp_path / "live-feed.json"
    planning_path = tmp_path / "data" / "planning-feed.json"
    platforms = {
        "github": {"id": "github", "name": "GitHub", "region": "global"},
        "geeknews": {"id": "geeknews", "name": "GeekNews", "region": "kr"},
    }
    raws = [
        RawItem(
            source_id="s1",
            source_name="GeekNews",
            platform_id="geeknews",
            category="social",
            url="https://news.hada.io/topic?id=99999",
            title="[독서 모임 모집] AI 시대 개발자 북클럽 참가 신청",
            body="선착순 모집합니다.",
            engagement=100.0,
            published_at=now - timedelta(hours=1),
        ),
        RawItem(
            source_id="s2",
            source_name="GitHub Hot AI",
            platform_id="github",
            category="dev",
            url="https://github.com/acme/agent-builder",
            title="acme/agent-builder: 웹앱용 AI 코딩 에이전트 오픈소스 공개",
            body="웹 앱 개발을 자동화하는 MCP 기반 에이전트 프레임워크로 응답 속도를 2.4배 높였습니다.",
            metrics={"feed": "github_trending", "repo": "acme/agent-builder", "stars": 180, "star_velocity": 9.5},
            engagement=250.0,
            published_at=now - timedelta(hours=2),
        ),
    ]
    cands = list(group_raw_items(raws).values())
    payload, changed = build_and_save_snapshot(
        snap_path,
        cands,
        platforms=platforms,
        now=now,
        planning_path=planning_path,
    )
    assert changed is True
    assert payload["item_count"] == 1
    item = payload["items"][0]
    assert "에 관한 소식이에요" not in item["what_ko"]
    assert item["highlight_summary"]
    assert set(item["utility_tip"].keys()) == {"when_needed", "work_utility", "practical_tip"}
    assert set(item["planning_meta"].keys()) == {"signal_type", "product_domain", "benchmark_point", "actionable_idea"}

    assert planning_path.exists()
    planning = json.loads(planning_path.read_text(encoding="utf-8"))
    assert planning["item_count"] == 1
    assert planning["signals"][0]["planning_meta"]["signal_type"] == "open_source_trend"


def test_apple_newsroom_strict_ai_filter():
    from adapters.rss import RSSAdapter, is_apple_ai_news

    assert is_apple_ai_news("Apple Intelligence expands with new Foundation Models and MLX tools") is True
    assert is_apple_ai_news("Apple opens new flagship retail store in Seoul") is False
    assert is_apple_ai_news("Apple TV+ announces new comedy drama season") is False

    xml = (
        "<?xml version='1.0'?><rss version='2.0'><channel><title>Apple Newsroom</title>"
        "<item><title>Apple opens new retail store in Gangnam</title>"
        "<link>https://www.apple.com/newsroom/2026/11/store/</link>"
        "<description>Customers can visit the new flagship store.</description></item>"
        "<item><title>Apple introduces new Core ML and MLX tools for Apple Intelligence</title>"
        "<link>https://www.apple.com/newsroom/2026/11/apple-intelligence-mlx/</link>"
        "<description>Developers can run on-device Foundation Models faster on Neural Engine.</description></item>"
        "</channel></rss>"
    )
    src = SourceConfig(
        id="apple-nr",
        platform_id="apple-ml",
        name="Apple Newsroom AI (Global)",
        endpoint="https://www.apple.com/newsroom/rss-feed.rss",
        method="rss",
        default_category="industry",
    )
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=xml)))
    items = RSSAdapter(src, client).fetch()
    assert len(items) == 1
    assert "apple-intelligence-mlx" in items[0].url


def test_anecdote_intro_never_leaks_into_summary_and_easy_original_is_longer(tmp_path: Path):
    now = datetime(2026, 11, 23, 11, 0, 0, tzinfo=timezone.utc)
    snap_path = tmp_path / "live-feed.json"
    platforms = {"gpters": {"id": "gpters", "name": "GPTers", "region": "kr"}}
    raws = [
        RawItem(
            source_id="s-gpters",
            source_name="GPTers",
            platform_id="gpters",
            category="video_audio",
            url="https://www.gpters.org/post/reels-claude-vs-autoke",
            title="AI로 릴스 편집하면 어떨까? 'Claude' VS 'Autoke'",
            body=(
                "저는 어느덧 4년차 로이킴 팬이 되어 11월 22일 로이킴 콘서트를 다녀왔습니다! "
                "매년 연말마다 막콘으로 다녀왔어요. "
                "이번에 촬영한 숏폼 영상을 AI로 자동 릴스 편집하기 위해 Claude와 Autoke 두 도구를 직접 비교해 봤습니다. "
                "Claude는 대본과 자막 타이밍 구성에 강했고, Autoke는 컷 편집 속도를 3배 단축해 주는 장점이 뚜렷했습니다."
            ),
            engagement=90.0,
            published_at=now - timedelta(hours=1),
        )
    ]
    cands = list(group_raw_items(raws).values())
    payload, _ = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now)
    item = payload["items"][0]
    assert "로이킴" not in item["what_ko"]
    assert "로이킴" not in item["highlight_summary"]
    assert "Claude" in item["what_ko"] or "Autoke" in item["what_ko"]

    summary_len = sum(len(str(item.get(k) or "")) for k in ("highlight_summary", "context_ko", "what_ko", "why_ko", "caveats_ko"))
    easy_len = sum(len(s["heading"]) + len(s["body"]) for s in item["easy_original"]["sections"])
    assert easy_len >= summary_len * 1.8
    assert len(item["easy_original"]["sections"]) >= 5

