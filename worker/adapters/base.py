"""BaseAdapter — 모든 수집 어댑터의 공통 뼈대.

규칙
- fetch() -> list[RawItem] 하나만 구현한다.
- 어댑터 하나가 예외를 던져도 파이프라인 전체는 멈추지 않는다 (runner 가 격리·기록).
- 네트워크는 생성자로 주입받은 httpx.Client 만 사용 → 테스트에서 MockTransport 로 대체 가능.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, ClassVar, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from collector.models import RawItem, SourceConfig

USER_AGENT = "AI-Radar/0.1 (+open-source AI news radar; contact via repository)"
DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


def make_http_client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=DEFAULT_TIMEOUT, follow_redirects=True)


def with_query(url: str, **params: Any) -> str:
    """URL 의 기존 쿼리를 보존하면서 파라미터를 덮어쓰기/추가 (list 값은 반복 키)."""
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in params]
    for k, v in params.items():
        if isinstance(v, (list, tuple)):
            query.extend((k, str(x)) for x in v)
        elif v is not None:
            query.append((k, str(v)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def parse_dt(value: Any) -> Optional[datetime]:
    """ISO8601 / epoch 초 / feedparser struct_time 을 UTC datetime 으로."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        if hasattr(value, "tm_year"):
            return datetime(*value[:6], tzinfo=timezone.utc)
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


class BaseAdapter:
    #: 이 어댑터가 담당하는 sources.endpoint 판별 (registry 에서 사용)
    endpoint_markers: ClassVar[tuple[str, ...]] = ()

    def __init__(self, source: SourceConfig, client: httpx.Client) -> None:
        self.source = source
        self.client = client

    @classmethod
    def matches(cls, source: SourceConfig) -> bool:
        return any(m in source.endpoint for m in cls.endpoint_markers)

    def fetch(self) -> list[RawItem]:  # pragma: no cover - 추상 메서드
        raise NotImplementedError

    # ── helpers ─────────────────────────────────────────────────────────────
    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        resp = self.client.get(url, **kwargs)
        resp.raise_for_status()
        return resp

    def get_json(self, url: str, **kwargs: Any) -> Any:
        return self.get(url, **kwargs).json()

    def item(self, **fields: Any) -> RawItem:
        """source 공통 필드를 채운 RawItem 생성."""
        fields.setdefault("category", self.source.default_category)
        return RawItem(
            source_id=self.source.id,
            source_name=self.source.name,
            platform_id=self.source.platform_id,
            **fields,
        )
