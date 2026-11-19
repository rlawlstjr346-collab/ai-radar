"""정규화 → 실행 내 그룹핑 → 기존 행과 병합. DB 와 무관한 순수 함수만 둔다 (테스트 용이).

items.metrics_json 내부 예약 키 (새 컬럼을 만들지 않기 위해 jsonb 안에 보관)
  _seen_sources : 이 이슈를 가져온 source_id 목록 → source_count 의 근거 (같은 소스 재수집은 가산 안 함)
  _engagement   : 소스 간 최대 반응 지표 → 점수 재계산용
  _excerpt      : 요약기에 넘길 원문 발췌 (최대 4000자). items 에 본문 컬럼이 없어서 여기에 둔다
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from collector.models import RawItem
from collector.normalize import canonicalize_url, make_dedup_key
from collector.scoring import importance_score

EXCERPT_LIMIT = 4000

# 링크를 '전달'하는 소스 — 같은 이슈의 원본 소스(논문·블로그·릴리스)가 있으면 제목·본문·소속을 양보한다
AGGREGATOR_PLATFORMS = {"hacker-news", "bluesky"}


def is_aggregator(platform_id: str) -> bool:
    return platform_id in AGGREGATOR_PLATFORMS


@dataclass
class Candidate:
    dedup_key: str
    canonical_url: str
    source_id: str
    platform_id: str
    category: str
    title: str
    body: str
    thumbnail_url: Optional[str]
    published_at: Optional[datetime]
    engagement: float
    metrics: dict
    seen_sources: list[str] = field(default_factory=list)
    source_names: list[str] = field(default_factory=list)

    @property
    def source_count(self) -> int:
        return max(1, len(self.seen_sources))

    def score(self, now: Optional[datetime] = None) -> float:
        return importance_score(self.engagement, self.source_count, self.published_at, now)


def group_raw_items(raws: list[RawItem]) -> dict[str, Candidate]:
    """같은 실행에서 여러 소스가 같은 이슈를 가져오면 하나로 합친다."""
    groups: dict[str, Candidate] = {}
    for r in raws:
        key = make_dedup_key(r.url)
        c = groups.get(key)
        if c is None:
            groups[key] = Candidate(
                dedup_key=key, canonical_url=canonicalize_url(r.url), source_id=r.source_id,
                platform_id=r.platform_id, category=r.category, title=r.title, body=r.body,
                thumbnail_url=r.thumbnail_url, published_at=r.published_at, engagement=r.engagement,
                metrics=dict(r.metrics), seen_sources=[r.source_id], source_names=[r.source_name],
            )
            continue
        if r.source_id not in c.seen_sources:
            c.seen_sources.append(r.source_id)
            c.source_names.append(r.source_name)
        c.engagement = max(c.engagement, r.engagement)
        c.metrics.update({k: v for k, v in r.metrics.items() if k not in c.metrics})
        if is_aggregator(c.platform_id) and not is_aggregator(r.platform_id):
            # 원본 소스가 들어오면 이슈의 대표 정보를 원본 기준으로 교체
            c.source_id, c.platform_id, c.category = r.source_id, r.platform_id, r.category
            c.title, c.body = r.title, r.body
        elif is_aggregator(r.platform_id) == is_aggregator(c.platform_id) and len(r.body) > len(c.body):
            c.body = r.body
        c.thumbnail_url = c.thumbnail_url or r.thumbnail_url
        if r.published_at and (c.published_at is None or r.published_at < c.published_at):
            c.published_at = r.published_at
    return groups


def new_item_row(c: Candidate, now: Optional[datetime] = None) -> dict:
    return {
        "source_id": c.source_id,
        "platform_id": c.platform_id,
        "canonical_url": c.canonical_url,
        "dedup_key": c.dedup_key,
        "original_title": c.title[:500],
        "category": c.category,
        "thumbnail_url": c.thumbnail_url,
        "metrics_json": {**c.metrics, "_seen_sources": c.seen_sources, "_engagement": c.engagement,
                         "_excerpt": c.body[:EXCERPT_LIMIT],
                         "_excerpt_from_aggregator": is_aggregator(c.platform_id)},
        "importance_score": c.score(now),
        "source_count": c.source_count,
        "published_at": c.published_at.isoformat() if c.published_at else None,
    }


def merge_into_existing(row: dict, c: Candidate, now: Optional[datetime] = None) -> dict:
    """기존 items 행 + 이번 후보 → UPDATE 할 필드만 반환."""
    old = dict(row.get("metrics_json") or {})
    seen = list(old.get("_seen_sources") or [row.get("source_id")])
    for sid in c.seen_sources:
        if sid not in seen:
            seen.append(sid)
    engagement = max(float(old.get("_engagement") or 0), c.engagement)
    excerpt = old.get("_excerpt") or ""
    old_agg = bool(old.get("_excerpt_from_aggregator"))
    new_agg = is_aggregator(c.platform_id)
    if (old_agg and not new_agg) or (old_agg == new_agg and len(c.body) > len(excerpt)):
        excerpt, old_agg = c.body[:EXCERPT_LIMIT], new_agg

    published = _parse(row.get("published_at")) or c.published_at
    metrics = {**old, **c.metrics, "_seen_sources": seen, "_engagement": engagement, "_excerpt": excerpt,
               "_excerpt_from_aggregator": old_agg}
    update = {
        "metrics_json": metrics,
        "source_count": len(seen),
        "importance_score": importance_score(engagement, len(seen), published, now),
    }
    if not row.get("thumbnail_url") and c.thumbnail_url:
        update["thumbnail_url"] = c.thumbnail_url
    return update


def _parse(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
