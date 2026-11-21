"""외국어 기사 0원 자동 한국어 번역 + URL 캐시 + published_at/fetched_at 분리 단위 테스트."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.base import FeedGuard, parse_dt  # noqa: E402
from collector.models import RawItem  # noqa: E402
from pipeline.merge import group_raw_items  # noqa: E402
from pipeline.snapshot import build_and_save_snapshot  # noqa: E402
from pipeline.translator import (  # noqa: E402
    ArticleTranslator,
    TranslationCache,
    hangul_ratio,
    needs_article_translation,
    needs_translation,
)


def test_hangul_ratio_and_detection():
    assert hangul_ratio("OpenAI releases new reasoning model") == 0.0
    assert needs_translation("OpenAI releases new reasoning model") is True
    assert needs_translation("2026年11月21日 今日のQiitaトレンド記事") is True
    assert needs_translation("华为云发布新一代大模型推理引擎") is True
    assert needs_translation("토스의 차세대 AI 에이전트 플랫폼 설계") is False
    assert hangul_ratio("GPT-6 출시: 비용 32% 절감") >= 0.20
    assert needs_article_translation("한국어 제목", raw_summary="This English summary has zero Korean text.") is True
    assert needs_article_translation("한국어 제목", raw_summary="한국어 본문 요약입니다.") is False


def test_translator_caches_by_url_and_preserves_feed_guard_meta(tmp_path: Path):
    now = datetime(2026, 11, 21, 2, 0, 0, tzinfo=timezone.utc)
    meta_path = tmp_path / "live-feed-meta.json"
    snap_path = tmp_path / "live-feed.json"
    platforms = {
        "aws-ml": {"id": "aws-ml", "name": "AWS Machine Learning Blog", "region": "global"},
        "qiita": {"id": "qiita", "name": "Qiita", "region": "jp"},
        "aitimes": {"id": "aitimes", "name": "AI타임스", "region": "kr"},
    }

    # FeedGuard 메타가 이미 존재하는 상태
    meta_path.write_text(
        json.dumps({"updated_at": "2026-11-21T01:00:00Z", "sources": {"https://aws.amazon.com/rss": {"etag": '"v1"'}}}),
        encoding="utf-8",
    )

    calls: list[str] = []

    def fake_translate(text: str) -> str:
        calls.append(text)
        if "AWS" in text:
            return "AWS 분산 KV 캐시로 셀프 호스팅 LLM 비용 절감"
        if "Qiita" in text:
            return "오늘의 Qiita 트렌드 기사를 팟캐스트로 듣기"
        return "자동 번역된 한국어 본문 내용으로 모델 추론 속도와 비용 효율을 개선했습니다."

    raws = [
        RawItem(
            source_id="s1",
            source_name="AWS ML",
            platform_id="aws-ml",
            category="dev",
            url="https://aws.amazon.com/blogs/ml/distributed-kv-cache",
            title="Cut self-hosted LLM cost with distributed KV cache on AWS",
            body="Distributed KV caching lowers latency and GPU memory overhead across inference clusters.",
            engagement=120.0,
            published_at=now - timedelta(hours=1),
        ),
        RawItem(
            source_id="s2",
            source_name="Qiita",
            platform_id="qiita",
            category="dev",
            url="https://qiita.com/trend/2026-11-21",
            title="2026年11月21日 今日のQiitaトレンド記事",
            body="生成AIとエージェント開発に関する最新トレンド記事をまとめました。",
            engagement=90.0,
            published_at=now - timedelta(hours=2),
        ),
        RawItem(
            source_id="s3",
            source_name="AI타임스",
            platform_id="aitimes",
            category="industry",
            url="https://aitimes.com/news/12345",
            title="국내 AI 반도체 스타트업 신규 칩 공개",
            body="국내 스타트업이 저전력 AI 추론 가속기를 공개하며 데이터센터 효율을 높였습니다.",
            engagement=100.0,
            published_at=now - timedelta(hours=1),
        ),
    ]
    cands = list(group_raw_items(raws).values())

    cache1 = TranslationCache(meta_path, now=now)
    tr1 = ArticleTranslator(cache=cache1, translate_text_fn=fake_translate, anthropic_api_key="", gemini_api_key="", delay_sec=0)
    payload1, changed1 = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now, meta_path=meta_path, translator=tr1)

    assert changed1 is True
    assert payload1["item_count"] == 3
    by_url = {it["canonical_url"]: it for it in payload1["items"]}

    aws = by_url["https://aws.amazon.com/blogs/ml/distributed-kv-cache"]
    assert aws["original_title"] == "Cut self-hosted LLM cost with distributed KV cache on AWS"
    assert aws["title_ko"] == "AWS 분산 KV 캐시로 셀프 호스팅 LLM 비용 절감"
    assert aws["hook_title"] == aws["title_ko"]
    assert not needs_translation(aws["what_ko"])
    for sec in aws["easy_original"]["sections"]:
        assert not needs_translation(sec["body"])
        if sec.get("quote"):
            assert not needs_translation(sec["quote"])

    qiita = by_url["https://qiita.com/trend/2026-11-21"]
    assert qiita["original_title"] == "2026年11月21日 今日のQiitaトレンド記事"
    assert not needs_translation(qiita["title_ko"])
    assert not needs_translation(qiita["what_ko"])

    # 한국어 기사는 번역기를 호출하지 않아야 한다
    assert all("국내 AI 반도체" not in c for c in calls)
    first_call_count = len(calls)
    assert first_call_count >= 2

    # FeedGuard sources 메타가 보존되면서 translations 캐시가 함께 저장됐는지 확인
    saved_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert "https://aws.amazon.com/rss" in saved_meta["sources"]
    assert "https://aws.amazon.com/blogs/ml/distributed-kv-cache" in saved_meta["translations"]

    # FeedGuard 재저장 시에도 translations 캐시가 날아가지 않아야 한다
    guard = FeedGuard(meta_path, jitter_range=(0.0, 0.0), now_fn=lambda: now)
    guard._dirty = True
    guard.save()
    after_guard = json.loads(meta_path.read_text(encoding="utf-8"))
    assert "https://aws.amazon.com/blogs/ml/distributed-kv-cache" in after_guard["translations"]

    # 2차 실행: 동일 URL 은 캐시에서 재사용 → 번역 호출 0회!
    calls.clear()
    cache2 = TranslationCache(meta_path, now=now + timedelta(hours=1))
    tr2 = ArticleTranslator(cache=cache2, translate_text_fn=fake_translate, anthropic_api_key="", gemini_api_key="", delay_sec=0)
    _, changed2 = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now + timedelta(hours=1), meta_path=meta_path, translator=tr2)
    assert calls == []
    assert tr2.stats["cache_hits"] == 2
    assert changed2 is False


def test_translator_failure_fallback_and_undated_separation(tmp_path: Path):
    now = datetime(2026, 11, 21, 2, 0, 0, tzinfo=timezone.utc)
    snap_path = tmp_path / "live-feed.json"
    platforms = {
        "openai": {"id": "openai", "name": "OpenAI", "region": "global"},
        "aitimes": {"id": "aitimes", "name": "AI타임스", "region": "kr"},
    }

    def broken_translate(_text: str) -> str:
        raise RuntimeError("translator temporarily down")

    raws = [
        # 날짜가 없는 원문: published_at 은 None 유지, fetched_at 만 기록
        RawItem(
            source_id="s1",
            source_name="OpenAI",
            platform_id="openai",
            category="industry",
            url="https://openai.com/index/no-date-article",
            title="New OpenAI Research Preview",
            body="This English body will fail translation and must not leak raw English into what_ko.",
            engagement=150.0,
            published_at=None,
        ),
        # KST 무타임존 날짜(UTC 로 오인되면 9시간 미래로 보임) → 9시간 보정해 실제 발행 시각 복원
        RawItem(
            source_id="s2",
            source_name="AI타임스",
            platform_id="aitimes",
            category="industry",
            url="https://aitimes.com/news/kst-naive",
            title="AI 데이터센터 신규 투자 발표",
            body="국내 AI 데이터센터 투자 계획이 오늘 오전 발표됐습니다.",
            engagement=100.0,
            published_at=datetime(2026, 11, 21, 10, 30, 0, tzinfo=timezone.utc),  # 10:30 KST == 01:30 UTC
        ),
    ]
    cands = list(group_raw_items(raws).values())
    tr = ArticleTranslator(translate_text_fn=broken_translate, anthropic_api_key="", gemini_api_key="", delay_sec=0)
    payload, changed = build_and_save_snapshot(snap_path, cands, platforms=platforms, now=now, translator=tr)

    assert changed is True
    assert payload["item_count"] == 2
    by_url = {it["canonical_url"]: it for it in payload["items"]}

    undated = by_url["https://openai.com/index/no-date-article"]
    assert undated["published_at"] is None
    assert undated["fetched_at"] == "2026-11-21T02:00:00Z"
    assert "must not leak" not in undated["what_ko"]

    kst_item = by_url["https://aitimes.com/news/kst-naive"]
    assert kst_item["published_at"] == "2026-11-21T01:30:00Z"
    assert kst_item["fetched_at"] == "2026-11-21T02:00:00Z"
    # 날짜 확인된 최신 기사가 날짜 미상 기사보다 상단에 정렬된다
    assert payload["items"][0]["canonical_url"] == "https://aitimes.com/news/kst-naive"


def test_parse_dt_handles_rfc2822_and_iso():
    dt1 = parse_dt("Sat, 21 Nov 2026 09:30:00 +0900")
    assert dt1 == datetime(2026, 11, 21, 0, 30, 0, tzinfo=timezone.utc)
    dt2 = parse_dt("2026-11-21T01:15:00Z")
    assert dt2 == datetime(2026, 11, 21, 1, 15, 0, tzinfo=timezone.utc)
