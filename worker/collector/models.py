"""수집 단계 공용 모델."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Category = Literal["llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"]


class SourceConfig(BaseModel):
    """public.sources 1행 (+ 실행에 필요한 platforms 정보)."""

    id: str
    platform_id: str
    name: str
    endpoint: str
    method: Literal["api", "rss"]
    default_category: Category
    is_enabled: bool = True
    fail_count: int = 0
    platform_status: Optional[str] = None   # platforms.collect_status (회복 처리용)


class RawItem(BaseModel):
    """어댑터가 돌려주는 정규화 전 원본 1건."""

    source_id: str
    source_name: str
    platform_id: str
    category: Category
    url: str
    title: str
    body: str = ""                                   # 요약기에 넘길 원문 발췌 (초록/설명/릴리스 노트)
    thumbnail_url: Optional[str] = None
    metrics: dict = Field(default_factory=dict)      # 원본 지표 그대로 (upvotes, likes, points ...)
    engagement: float = 0.0                          # 소스 간 비교용 'HN 포인트 환산' 반응 지표
    published_at: Optional[datetime] = None
