"""중요도 스코어링.

score = 10·log10(1 + engagement)          반응(소스별로 'HN 포인트 환산'된 값)
      + 6·(source_count − 1)               여러 소스에 동시 등장 가산
      + 8·recency                          최신성: exp(−경과시간/48h), 날짜 미상은 0.5

대략 0 ~ 50 범위. 상위 N 개만 LLM 요약 단계로 넘어간다.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

W_ENGAGEMENT = 10.0
W_MULTI_SOURCE = 6.0
W_RECENCY = 8.0
RECENCY_HALF_LIFE_HOURS = 48.0


def recency_factor(published_at: Optional[datetime], now: Optional[datetime] = None) -> float:
    if published_at is None:
        return 0.5
    now = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_h = max(0.0, (now - published_at).total_seconds() / 3600)
    return math.exp(-age_h / RECENCY_HALF_LIFE_HOURS)


def hot_rank_score(importance: float, created_at: Optional[datetime], now: Optional[datetime] = None) -> float:
    """신선도 중력 정렬: importance / (수집 후 경과시간h + 2)^1.5 — 003 마이그레이션의 SQL 함수와 같은 식."""
    now = now or datetime.now(timezone.utc)
    if created_at is None:
        age_h = 0.0
    else:
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_h = max(0.0, (now - created_at).total_seconds() / 3600)
    return max(0.0, importance) / math.pow(age_h + 2, 1.5)


def importance_score(engagement: float, source_count: int, published_at: Optional[datetime],
                     now: Optional[datetime] = None) -> float:
    score = (
        W_ENGAGEMENT * math.log10(1 + max(0.0, engagement))
        + W_MULTI_SOURCE * max(0, source_count - 1)
        + W_RECENCY * recency_factor(published_at, now)
    )
    return round(score, 3)
