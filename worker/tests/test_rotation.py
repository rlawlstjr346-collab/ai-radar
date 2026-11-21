"""7개 카테고리 분류 + 1시간 주기 유입 수문(cap·플랫폼 쿼터·신선도 정렬) 테스트."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.classify import classify_hf_model, classify_news, classify_space  # noqa: E402
from collector.models import SourceConfig  # noqa: E402
from collector.scoring import hot_rank_score  # noqa: E402
from pipeline.runner import DEFAULT_TOP_N, PER_PLATFORM_CAP, run_pipeline, select_for_summary  # noqa: E402
from pipeline.store import SEED_SQL, MemoryStore, load_seed_platform_names, load_seed_sources  # noqa: E402

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
SEVEN = {"llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"}


# ── 카테고리 ─────────────────────────────────────────────────────────────────
def test_seed_uses_only_seven_categories_and_covers_all():
    sources = load_seed_sources()
    assert {s.default_category for s in sources} <= SEVEN
    names = load_seed_platform_names()
    assert len(names) == 141                                    # 기존 26곳 + 6개 권역 확장 115곳
    base = load_seed_platform_names(SEED_SQL)
    assert len(base) == 26 and set(base) <= set(names)          # 기존 26곳 보존


@pytest.mark.parametrize("tag, tags, expected", [
    ("text-generation", [], "llm_chat"),
    ("text-to-image", [], "image_design"),
    ("text-to-speech", [], "video_audio"),
    ("audio-to-audio", ["speech"], "video_audio"),
    ("feature-extraction", ["sentence-transformers"], "dev"),
])
def test_classify_hf_model(tag, tags, expected):
    assert classify_hf_model(tag, tags) == expected


def test_classify_space_and_news():
    assert classify_space("music gen make a song") == "video_audio"
    assert classify_space("anime style portrait") == "image_design"
    assert classify_space("chat with your pdf") == "llm_chat"
    assert classify_space("llm leaderboard rankings") is None
    assert classify_news("Anthropic prices initial public offering", "dev") == "industry"
    assert classify_news("New paper on sparse attention", "dev") == "research"
    assert classify_news("Show HN: my terminal agent", "dev") == "dev"


# ── 신선도 중력 ───────────────────────────────────────────────────────────────
def test_hot_rank_fresh_beats_old_high_score():
    fresh = hot_rank_score(20, NOW - timedelta(hours=1), NOW)
    old_big = hot_rank_score(40, NOW - timedelta(hours=30), NOW)
    assert fresh > old_big
    assert hot_rank_score(10, NOW, NOW) == pytest.approx(10 / 2 ** 1.5)
    assert hot_rank_score(10, NOW + timedelta(hours=1), NOW) == hot_rank_score(10, NOW, NOW)   # 미래 시각 방어


# ── 유입 수문 ────────────────────────────────────────────────────────────────
def row(i, platform, hours_ago, score=30.0):
    return {"id": str(i), "platform_id": platform, "importance_score": score,
            "created_at": (NOW - timedelta(hours=hours_ago)).isoformat()}


def test_select_caps_at_four_with_max_two_per_platform():
    rows = [row(i, "huggingface", 0.5) for i in range(6)] + [row(10, "openai", 2), row(11, "civitai", 3),
                                                              row(12, "bluesky", 50)]
    picked = select_for_summary(rows, cap=DEFAULT_TOP_N, now=NOW)
    assert DEFAULT_TOP_N == 4 and PER_PLATFORM_CAP == 2
    assert len(picked) == 4
    assert sum(r["platform_id"] == "huggingface" for r in picked) == 2
    assert {r["platform_id"] for r in picked} == {"huggingface", "openai", "civitai"}   # 50시간 전 글은 밀려남


def test_select_handles_small_pool():
    assert select_for_summary([row(1, "x", 1)], cap=4, now=NOW) == [row(1, "x", 1)]
    assert select_for_summary([], cap=4, now=NOW) == []


class CountingSummarizer:
    def __init__(self):
        self.items = []

    def summarize(self, item, glossary=None):
        from summarizer_schema import SummaryLLMOutput, SummaryResult
        self.items.append(item)
        out = SummaryLLMOutput.model_validate({
            "_fact_sheet": {"what_it_is": "x", "key_claims": [], "metrics": [], "compared_against": [],
                            "license": None, "availability": None, "limitations": [], "not_stated": []},
            "hook_title": "t", "benefit_tag": None, "context_ko": "c", "what_ko": "w", "analogy_ko": None, "why_ko": "y",
            "caveats_ko": None, "difficulty": 1, "terms": [], "extracted_entities": []})
        return SummaryResult(output=out, prompt_version="t", model="stub")


def test_hourly_run_summarizes_at_most_four_and_never_resummarizes():
    papers = [{"paper": {"id": f"2611.0000{i}", "title": f"P{i}", "summary": "a", "upvotes": 50 - i,
                         "publishedAt": NOW.isoformat()}} for i in range(8)]

    def handler(request):
        return httpx.Response(200, json=papers)

    src = SourceConfig(id="p", platform_id="huggingface", name="HF Daily Papers",
                       endpoint="https://huggingface.co/api/daily_papers", method="api", default_category="research")
    store = MemoryStore(sources=[src], platform_names={})
    stub = CountingSummarizer()
    client = httpx.Client(transport=httpx.MockTransport(handler))

    run_pipeline(store, summarizer=stub, client=client, top_n=DEFAULT_TOP_N, daily_cap=96)
    assert len(stub.items) == 2                 # 같은 플랫폼 2개 쿼터가 4개 cap 보다 먼저 걸림
    run_pipeline(store, summarizer=stub, client=client, top_n=DEFAULT_TOP_N, daily_cap=96)
    titles = [i.original_title for i in stub.items]
    assert len(titles) == 4 and len(set(titles)) == 4      # 두 번째 실행은 '새' 아이템만, 재요약 없음
    assert all(r["source_count"] == 1 for r in store.items.values())
