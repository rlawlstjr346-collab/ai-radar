"""5단계 파이프라인 실행기.

1. 수집 & 정규화   — 활성 소스별 어댑터 실행 (병렬, 소스 단위 장애 격리 + 소스 건강 기록)
2. 중복 병합       — 같은 dedup_key 는 하나로, 다른 소스에서 또 나오면 source_count·점수 가산
3. 유입 수문       — 미요약 hot 아이템을 신선도 중력(hot_rank) 순으로, 실행당 최대 4개·플랫폼당 최대 2개
                     (하루 상한 DAILY_SUMMARY_CAP). 이미 요약된 이슈는 지표만 갱신되고 재요약 안 함
4. 단일 호출 요약  — summarizer (요약기 없으면 이 단계 건너뜀)
5. 퇴장 수문(TTL)  — apply_item_lifecycle(): hot 0~7일 → warm 8~30일 → archived 31일+
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from adapters import resolve_adapter
from adapters.base import make_http_client
from collector.models import RawItem, SourceConfig
from collector.scoring import hot_rank_score
from pipeline.merge import Candidate, group_raw_items

log = logging.getLogger("ai_radar.pipeline")

# 1시간 주기 기준 유입 수문: 실행 1회당 신규 요약 최대 4개(하루 최대 96개), 같은 플랫폼은 1회 최대 2개
DEFAULT_TOP_N = 4
DEFAULT_DAILY_CAP = 96
PER_PLATFORM_CAP = 2
CANDIDATE_POOL = 40          # 요약 후보를 고를 때 살펴볼 미요약 hot 아이템 수


def select_for_summary(rows: list[dict], cap: int, per_platform: int = PER_PLATFORM_CAP,
                       now: Optional[datetime] = None) -> list[dict]:
    """미요약 후보 → 신선도 중력 순으로 정렬 → 플랫폼별 쿼터를 지키며 cap 개까지."""
    now = now or datetime.now(timezone.utc)

    def rank(r: dict) -> float:
        created = r.get("created_at")
        if isinstance(created, str):
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        return hot_rank_score(float(r.get("importance_score") or 0), created, now)

    picked: list[dict] = []
    per: dict[str, int] = {}
    for r in sorted(rows, key=rank, reverse=True):
        pid = r.get("platform_id", "")
        if per.get(pid, 0) >= per_platform:
            continue
        picked.append(r)
        per[pid] = per.get(pid, 0) + 1
        if len(picked) >= cap:
            break
    return picked


@dataclass
class SourceRun:
    source: SourceConfig
    items: list[RawItem] = field(default_factory=list)
    error: Optional[str] = None
    notes: list[str] = field(default_factory=list)


@dataclass
class PipelineReport:
    sources: list[SourceRun] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    persist: dict = field(default_factory=dict)
    summarized: list[str] = field(default_factory=list)
    summary_errors: list[str] = field(default_factory=list)
    summary_skipped_reason: Optional[str] = None
    lifecycle: dict = field(default_factory=dict)


def collect(sources: list[SourceConfig], client: httpx.Client, max_workers: int = 16) -> list[SourceRun]:
    """모든 소스를 동시에 병렬 수집 (I/O 대기형이라 스레드로 충분 — 1시간 주기 5분 타임아웃 안에 끝나도록)."""
    def run_one(src: SourceConfig) -> SourceRun:
        run = SourceRun(source=src)
        try:
            adapter = resolve_adapter(src, client)
            run.items = adapter.fetch()
            run.notes.extend(getattr(adapter, "skipped", []))
        except Exception as e:                                # 소스 하나의 장애가 전체를 멈추지 않게
            run.error = f"{type(e).__name__}: {e}"[:300]
            log.warning("source failed: %s — %s", src.name, run.error)
        return run

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(run_one, sources))


def run_pipeline(store: Any, *, summarizer: Any = None, client: Optional[httpx.Client] = None,
                 top_n: int = DEFAULT_TOP_N, daily_cap: int = DEFAULT_DAILY_CAP,
                 run_lifecycle: bool = True) -> PipelineReport:
    report = PipelineReport()
    own_client = client is None
    client = client or make_http_client()
    try:
        # 1. 수집
        report.sources = collect(store.load_sources(), client)
        for run in report.sources:
            if run.error:
                store.record_failure(run.source)
            else:
                store.record_success(run.source)

        # 2. 병합
        raws = [it for run in report.sources for it in run.items]
        now = datetime.now(timezone.utc)
        report.candidates = sorted(group_raw_items(raws).values(), key=lambda c: c.score(now), reverse=True)
        report.persist = store.persist(report.candidates)

        # 3~4. 컷오프 & 요약
        if summarizer is None:
            report.summary_skipped_reason = "summarizer disabled (no ANTHROPIC_API_KEY or --no-summarize)"
        else:
            budget = min(top_n, max(0, daily_cap - store.summaries_created_today()))
            if budget == 0:
                report.summary_skipped_reason = f"daily cap reached ({daily_cap})"
            else:
                _summarize_top(store, summarizer, budget, report)

        # 5. TTL
        if run_lifecycle:
            report.lifecycle = store.apply_lifecycle()
    finally:
        if own_client:
            client.close()
    return report


def _summarize_top(store: Any, summarizer: Any, budget: int, report: PipelineReport) -> None:
    from summarizer import SummarizeError
    from summarizer_schema import SummaryInput

    glossary = store.fetch_glossary()
    names = store.platform_names()
    # 이미 요약된 dedup_key 는 후보에서 빠져 있음(지표만 갱신) → 재요약 없음
    pool = store.top_unsummarized(max(CANDIDATE_POOL, budget))
    for row in select_for_summary(pool, budget):
        metrics = dict(row.get("metrics_json") or {})
        body = metrics.pop("_excerpt", "")
        public_metrics = {k: v for k, v in metrics.items() if not k.startswith("_")}
        source_name = ((row.get("sources") or {}).get("name") if isinstance(row.get("sources"), dict) else None)
        item = SummaryInput(
            item_id=row["id"], platform_id=row["platform_id"], platform_name=names.get(row["platform_id"]),
            source_name=source_name or row["platform_id"], category=row["category"],
            original_title=row["original_title"], canonical_url=row["canonical_url"],
            body=body, metrics=public_metrics,
        )
        try:
            result = summarizer.summarize(item, glossary=glossary)
            store.save_summary(row["id"], result)
            report.summarized.append(row["canonical_url"])
            glossary = glossary + [g for g in result.to_glossary_rows()
                                   if g["term"] not in {x["term"] for x in glossary}]
        except SummarizeError as e:
            report.summary_errors.append(f"{row['canonical_url']}: {e}")
        except Exception as e:                                 # API 장애 등 — 다음 아이템 계속
            report.summary_errors.append(f"{row['canonical_url']}: {type(e).__name__}: {e}"[:300])
