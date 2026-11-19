"""파이프라인 통합 테스트 — 가짜 어댑터 응답 + MemoryStore."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.models import RawItem, SourceConfig  # noqa: E402
from pipeline.merge import group_raw_items, merge_into_existing, new_item_row  # noqa: E402
from pipeline.runner import run_pipeline  # noqa: E402
from pipeline.store import MemoryStore  # noqa: E402
from summarizer_schema import SummaryLLMOutput, SummaryResult  # noqa: E402

NOW = datetime.now(timezone.utc)


def raw(source_id, url, engagement=10.0, body="b", title="T"):
    return RawItem(source_id=source_id, source_name=source_id, platform_id="huggingface", category="research",
                   url=url, title=title, body=body, engagement=engagement, published_at=NOW)


def test_group_merges_same_issue_from_different_sources():
    groups = group_raw_items([
        raw("papers", "https://arxiv.org/abs/2611.00001", 40, body="long abstract text"),
        raw("hn", "https://arxiv.org/pdf/2611.00001v2.pdf?utm_source=hn", 300, body="short"),
        raw("papers", "https://arxiv.org/abs/2611.00002", 5),
    ])
    c = groups["arxiv:2611.00001"]
    assert c.source_count == 2 and c.engagement == 300 and c.body == "long abstract text"
    assert c.score() > groups["arxiv:2611.00002"].score()


def test_merge_existing_counts_only_new_sources():
    c1 = group_raw_items([raw("papers", "https://arxiv.org/abs/2611.00001", 40)])["arxiv:2611.00001"]
    row = {"source_id": "papers", **new_item_row(c1)}
    same_again = merge_into_existing(row, c1)
    assert same_again["source_count"] == 1                     # 같은 소스 재수집은 가산 없음
    c2 = group_raw_items([raw("bsky", "https://arxiv.org/abs/2611.00001", 20)])["arxiv:2611.00001"]
    upd = merge_into_existing(row, c2)
    assert upd["source_count"] == 2
    assert upd["importance_score"] > row["importance_score"]
    assert upd["metrics_json"]["_seen_sources"] == ["papers", "bsky"]


def test_original_source_body_beats_aggregator_in_db_merge():
    hn = RawItem(source_id="hn", source_name="HN", platform_id="hacker-news", category="dev",
                 url="https://arxiv.org/abs/2611.00009", title="HN title", body="HN boilerplate that is long " * 5,
                 engagement=100, published_at=NOW)
    c_hn = group_raw_items([hn])["arxiv:2611.00009"]
    row = {"source_id": "hn", **new_item_row(c_hn)}
    c_paper = group_raw_items([raw("papers", "https://arxiv.org/abs/2611.00009", 4, body="abstract")])[
        "arxiv:2611.00009"]
    upd = merge_into_existing(row, c_paper)
    assert upd["metrics_json"]["_excerpt"] == "abstract"
    assert upd["metrics_json"]["_excerpt_from_aggregator"] is False
    # 그 뒤 HN 이 또 와도 원본 발췌를 덮어쓰지 않음
    row2 = {**row, **upd}
    assert merge_into_existing(row2, c_hn)["metrics_json"]["_excerpt"] == "abstract"


# ── run_pipeline end-to-end (네트워크는 MockTransport) ───────────────────────
def sources():
    return [
        SourceConfig(id="papers", platform_id="huggingface", name="HF Daily Papers",
                     endpoint="https://huggingface.co/api/daily_papers", method="api", default_category="research"),
        SourceConfig(id="broken", platform_id="openai", name="Broken Feed",
                     endpoint="https://broken.example/rss.xml", method="rss", default_category="research"),
        SourceConfig(id="hn", platform_id="hacker-news", name="HN",
                     endpoint="https://hn.algolia.com/api/v1/search_by_date?tags=story", method="api",
                     default_category="dev"),
    ]


def handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    if host == "huggingface.co":
        return httpx.Response(200, json=[
            {"paper": {"id": "2611.00001", "title": "Long Context Paper", "summary": "abstract", "upvotes": 30,
                       "publishedAt": NOW.isoformat()}},
            {"paper": {"id": "2611.00002", "title": "Other Paper", "summary": "x", "upvotes": 1,
                       "publishedAt": NOW.isoformat()}},
        ])
    if host == "hn.algolia.com":
        return httpx.Response(200, json={"hits": [
            {"objectID": "9", "title": "LLM long context paper", "url": "https://arxiv.org/abs/2611.00001",
             "points": 200, "created_at": NOW.isoformat()}]})
    return httpx.Response(503)


class StubSummarizer:
    def __init__(self):
        self.calls = []

    def summarize(self, item, glossary=None):
        self.calls.append(item)
        out = SummaryLLMOutput.model_validate({
            "_fact_sheet": {"what_it_is": "x", "key_claims": [], "metrics": [], "compared_against": [],
                            "license": None, "availability": None, "limitations": [], "not_stated": []},
            "hook_title": "훅", "context_ko": "c", "what_ko": "w", "analogy_ko": None, "why_ko": "y",
            "caveats_ko": None, "difficulty": 2,
            "terms": [{"term": "LLM", "display_name": "LLM", "easy": "말 잘하는 AI예요."}],
            "extracted_entities": [],
        })
        return SummaryResult(output=out, prompt_version="test", model="stub")


def test_run_pipeline_isolates_failures_merges_and_respects_caps():
    store = MemoryStore(sources=sources(), platform_names={"huggingface": "Hugging Face"})
    stub = StubSummarizer()
    client = httpx.Client(transport=httpx.MockTransport(handler))

    report = run_pipeline(store, summarizer=stub, client=client, top_n=1, daily_cap=20)

    by_id = {r.source.id: r for r in report.sources}
    assert by_id["broken"].error and not by_id["papers"].error          # 장애 격리
    assert store.health["broken"]["fail_count"] == 1
    assert store.health["papers"]["fail_count"] == 0
    assert report.persist == {"inserted": 2, "merged": 0, "skipped": 0}
    top = report.candidates[0]
    assert top.dedup_key == "arxiv:2611.00001" and top.source_count == 2

    assert len(stub.calls) == 1                                          # top_n 컷오프
    assert stub.calls[0].original_title == "Long Context Paper"
    assert stub.calls[0].body == "abstract"                              # _excerpt 가 요약기 본문으로
    assert stub.calls[0].platform_name == "Hugging Face"
    assert "_seen_sources" not in stub.calls[0].metrics                  # 내부 키는 LLM 에 안 보냄
    assert "llm" in store.glossary

    # 두 번째 실행: 같은 소스 재수집 → 병합만, source_count 그대로, 실패 카운트 누적
    report2 = run_pipeline(store, summarizer=stub, client=client, top_n=5, daily_cap=2)
    assert report2.persist["merged"] == 2 and report2.persist["inserted"] == 0
    assert store.items["arxiv:2611.00001"]["source_count"] == 2
    assert store.health["broken"]["fail_count"] == 2
    assert len(stub.calls) == 2                                          # daily_cap=2 → 남은 1건만


def test_daily_cap_reached_skips_llm():
    store = MemoryStore(sources=sources()[:1], platform_names={})
    store.summaries = {"a": {}, "b": {}}
    stub = StubSummarizer()
    report = run_pipeline(store, summarizer=stub, client=httpx.Client(transport=httpx.MockTransport(handler)),
                          top_n=5, daily_cap=2)
    assert stub.calls == [] and "daily cap" in report.summary_skipped_reason


def test_no_summarizer_still_collects():
    store = MemoryStore(sources=sources()[:1], platform_names={})
    report = run_pipeline(store, client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert report.persist["inserted"] == 2 and report.summary_skipped_reason


def test_unused_namespace():
    assert SimpleNamespace(a=1).a == 1
