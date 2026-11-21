"""FeedGuard(ETag/304, 429/403 6시간 Circuit Breaker, 도메인 jitter) + live-feed.json 스냅샷 단위 테스트."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.base import (  # noqa: E402
    USER_AGENT,
    CooldownError,
    FeedGuard,
    NotModifiedError,
    make_http_client,
)
from adapters.rss import RSSAdapter  # noqa: E402
from collector.models import RawItem, SourceConfig  # noqa: E402
from pipeline.merge import group_raw_items  # noqa: E402
from pipeline.runner import run_pipeline  # noqa: E402
from pipeline.snapshot import build_and_save_snapshot, sanitize_text  # noqa: E402
from pipeline.store import MemoryStore  # noqa: E402


def _src(url: str, pid: str = "openai", name: str = "OpenAI News") -> SourceConfig:
    return SourceConfig(id=f"s-{pid}", platform_id=pid, name=name, endpoint=url, method="rss", default_category="industry")


def test_user_agent_is_standard_feed_reader():
    assert USER_AGENT == "AI-Radar-FeedReader/1.0 (+https://ai-radar.vercel.app; RSS aggregator)"
    with make_http_client() as client:
        assert client.headers["user-agent"] == USER_AGENT


def test_feed_guard_etag_last_modified_and_304_skip(tmp_path: Path):
    meta_file = tmp_path / "live-feed-meta.json"
    now = datetime(2026, 11, 21, 1, 0, 0, tzinfo=timezone.utc)
    seen_headers: list[dict[str, str]] = []
    call_count = 0

    xml = (
        "<?xml version='1.0'?><rss version='2.0'><channel><title>T</title>"
        "<item><title>Gemini 4 Update</title><link>https://deepmind.google/blog/x</link>"
        "<description>Summary text</description></item></channel></rss>"
    )

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        seen_headers.append(dict(req.headers))
        if call_count == 1:
            return httpx.Response(
                200,
                text=xml,
                headers={"ETag": '"v1-etag"', "Last-Modified": "Sat, 21 Nov 2026 00:00:00 GMT"},
            )
        return httpx.Response(304)

    guard = FeedGuard(meta_file, jitter_range=(0.0, 0.0), now_fn=lambda: now)
    client = httpx.Client(transport=httpx.MockTransport(handler))
    src = _src("https://deepmind.google/blog/rss.xml", "google-deepmind", "Google DeepMind Blog")

    # 1차 요청: 200 → ETag / Last-Modified 저장
    items = RSSAdapter(src, client, guard=guard).fetch()
    assert len(items) == 1
    guard.save()
    saved = json.loads(meta_file.read_text(encoding="utf-8"))
    entry = saved["sources"][src.endpoint]
    assert entry["etag"] == '"v1-etag"'
    assert entry["last_modified"] == "Sat, 21 Nov 2026 00:00:00 GMT"
    assert entry["cooldown_until"] is None

    # 2차 요청(재시작 시뮬레이션): If-None-Match / If-Modified-Since 전송 → 304 즉시 스킵
    guard2 = FeedGuard(meta_file, jitter_range=(0.0, 0.0), now_fn=lambda: now + timedelta(hours=1))
    with pytest.raises(NotModifiedError):
        RSSAdapter(src, client, guard=guard2).fetch()
    assert seen_headers[1].get("if-none-match") == '"v1-etag"'
    assert seen_headers[1].get("if-modified-since") == "Sat, 21 Nov 2026 00:00:00 GMT"


def test_feed_guard_circuit_breaker_on_429_and_403(tmp_path: Path):
    meta_file = tmp_path / "live-feed-meta.json"
    clock = [datetime(2026, 11, 21, 1, 0, 0, tzinfo=timezone.utc)]
    hits = []

    def handler(req: httpx.Request) -> httpx.Response:
        hits.append(str(req.url))
        if "rate" in str(req.url):
            return httpx.Response(429)
        return httpx.Response(403)

    guard = FeedGuard(meta_file, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    client = httpx.Client(transport=httpx.MockTransport(handler))
    store = MemoryStore(sources=[
        _src("https://rate.example.net/rss.xml", "openai", "Rate"),
        _src("https://forbid.example.net/rss.xml", "anthropic", "Forbid"),
    ])

    # 1회차: 429 / 403 기록 → 6시간 쿨다운 설정
    report1 = run_pipeline(store, client=client, guard=guard, run_lifecycle=False)
    assert all(r.error for r in report1.sources)
    assert len(hits) == 2

    saved = json.loads(meta_file.read_text(encoding="utf-8"))
    for ep in ("https://rate.example.net/rss.xml", "https://forbid.example.net/rss.xml"):
        assert saved["sources"][ep]["cooldown_until"] == "2026-11-21T07:00:00Z"

    # 2회차(2시간 후): 네트워크 호출 0회로 즉시 Circuit Breaker 스킵
    clock[0] = clock[0] + timedelta(hours=2)
    guard2 = FeedGuard(meta_file, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    report2 = run_pipeline(store, client=client, guard=guard2, run_lifecycle=False)
    assert len(hits) == 2  # 추가 HTTP 요청 없음!
    assert all(r.skipped_reason == "cooldown" and r.error is None for r in report2.sources)

    # 3회차(7시간 후): 쿨다운 해제 → 다시 요청 시도
    clock[0] = clock[0] + timedelta(hours=5)
    guard3 = FeedGuard(meta_file, jitter_range=(0.0, 0.0), now_fn=lambda: clock[0])
    with pytest.raises(httpx.HTTPStatusError):
        RSSAdapter(store.sources[0], client, guard=guard3).fetch()
    assert len(hits) == 3

    # CooldownError 직접 확인
    with pytest.raises(CooldownError):
        RSSAdapter(store.sources[0], client, guard=guard3).fetch()


def test_feed_guard_domain_politeness_jitter():
    sleeps: list[float] = []
    mono = [100.0]

    def fake_sleep(sec: float) -> None:
        sleeps.append(sec)
        mono[0] += sec

    guard = FeedGuard(
        jitter_range=(1.5, 2.5),
        sleep_fn=fake_sleep,
        monotonic_fn=lambda: mono[0],
        rand_fn=lambda a, b: 2.0,
    )
    # 첫 요청: 대기 없음
    guard.wait_for_domain("https://same.host/a")
    assert sleeps == []
    # 다른 도메인: 대기 없음
    guard.wait_for_domain("https://other.host/b")
    assert sleeps == []
    # 같은 도메인 연속 요청: 1.5~2.5초(모킹 2.0초) 대기
    guard.wait_for_domain("https://same.host/c")
    assert sleeps == [pytest.approx(2.0)]


def test_snapshot_sanitizes_prunes_30d_and_detects_no_change(tmp_path: Path):
    now = datetime(2026, 11, 21, 1, 0, 0, tzinfo=timezone.utc)
    snap_path = tmp_path / "live-feed.json"
    platforms = {
        "google-deepmind": {"id": "google-deepmind", "name": "Google DeepMind", "region": "global"},
        "toss-tech": {"id": "toss-tech", "name": "토스테크 (Toss Tech)", "region": "kr"},
    }

    # 기존 35일 지난 기사는 자동 정리돼야 한다
    old_item = {
        "id": "live-old000000001",
        "platform_id": "google-deepmind",
        "canonical_url": "https://deepmind.google/blog/ancient",
        "created_at": (now - timedelta(days=35)).isoformat().replace("+00:00", "Z"),
        "lifecycle_status": "warm",
    }
    snap_path.write_text(json.dumps({"version": 1, "items": [old_item]}), encoding="utf-8")

    raws = [
        RawItem(
            source_id="s1",
            source_name="Google DeepMind Blog",
            platform_id="google-deepmind",
            category="llm_chat",
            url="https://deepmind.google/blog/gemini-4-launch",
            title="충격! Gemini 4 Neon TODO 오픈소스 공개",
            body="Gemini 4 Neon reduces cost by 32% with open-source tooling and LLM inference improvements. 준비 중 안내 없음.",
            engagement=150.0,
            published_at=now - timedelta(minutes=30),
        ),
        RawItem(
            source_id="s2",
            source_name="토스테크",
            platform_id="toss-tech",
            category="dev",
            url="https://toss.tech/article/agent-platform-v2",
            title="토스의 차세대 AI 에이전트 플랫폼 설계",
            body="사내 망분리 환경에서 LLM 에이전트를 안전하게 운영하는 아키텍처를 소개합니다.",
            engagement=90.0,
            published_at=now - timedelta(days=10),
        ),
        # http:// 또는 example.com 은 자동 제외
        RawItem(
            source_id="s3",
            source_name="Bad",
            platform_id="google-deepmind",
            category="dev",
            url="https://example.com/fake",
            title="Fake",
            body="Fake",
            engagement=50.0,
            published_at=now,
        ),
    ]
    cands = list(group_raw_items(raws).values())

    payload, changed = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now)
    assert changed is True
    assert payload["item_count"] == 2
    by_url = {it["canonical_url"]: it for it in payload["items"]}
    assert "https://deepmind.google/blog/ancient" not in by_url
    assert "https://example.com/fake" not in by_url

    gm = by_url["https://deepmind.google/blog/gemini-4-launch"]
    assert gm["lifecycle_status"] == "hot"
    assert gm["easy_original_ready"] is True
    assert len(gm["easy_original"]["sections"]) >= 3
    blob = json.dumps(gm, ensure_ascii=False)
    for banned in ("충격", "TODO", "준비 중", "샘플 데이터 모드", "혁신적"):
        assert banned not in blob

    toss = by_url["https://toss.tech/article/agent-platform-v2"]
    assert toss["lifecycle_status"] == "warm"

    # 동일 데이터 재실행: changed=False (불필요 커밋 방지)
    _, changed2 = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now + timedelta(minutes=5))
    assert changed2 is False


def test_sanitize_text_strips_banned_and_emoji():
    cleaned = sanitize_text("🔥 역대급 혁신적인 AI 도구 Coming Soon (TODO)", strip_emoji=True)
    for banned in ("🔥", "역대급", "혁신적", "Coming Soon", "TODO"):
        assert banned not in cleaned
