"""BaseAdapter — 모든 수집 어댑터의 공통 뼈대 + IP 밴 0% 방어 계층(FeedGuard).

규칙
- fetch() -> list[RawItem] 하나만 구현한다.
- 어댑터 하나가 예외를 던져도 파이프라인 전체는 멈추지 않는다 (runner 가 격리·기록).
- 네트워크는 생성자로 주입받은 httpx.Client 만 사용 → 테스트에서 MockTransport 로 대체 가능.
- FeedGuard 가 주입되면:
  1) 정직한 표준 User-Agent 전송
  2) ETag(If-None-Match) / Last-Modified(If-Modified-Since) 조건부 요청 → 304 Not Modified 즉시 스킵
  3) 동일 도메인 연속 요청 시 1.5~2.5초 예의 간격(jitter)
  4) 429 / 403 응답 시 재시도 폭격 없이 해당 소스에 6시간 cooldown_until 기록(Circuit Breaker)
"""

from __future__ import annotations

import email.utils
import json
import random
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, ClassVar, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from collector.models import RawItem, SourceConfig

USER_AGENT = "AI-Radar-FeedReader/1.0 (+https://ai-radar.vercel.app; RSS aggregator)"
DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
DEFAULT_JITTER_RANGE: tuple[float, float] = (1.5, 2.5)
DEFAULT_COOLDOWN_HOURS: float = 6.0


class SourceSkippedError(Exception):
    """어댑터가 정책(304 Not Modified 또는 Circuit Breaker 쿨다운)으로 요청을 정상 건너뛴 경우."""


class NotModifiedError(SourceSkippedError):
    """서버가 304 Not Modified 를 반환해 본문 파싱을 즉시 생략."""


class CooldownError(SourceSkippedError):
    """이전 429/403 응답으로 Circuit Breaker 휴식 중이라 요청을 생략."""


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
    """ISO8601 / RFC2822 / epoch 초 / feedparser struct_time 을 UTC datetime 으로."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        if hasattr(value, "tm_year"):
            return datetime(*value[:6], tzinfo=timezone.utc)
        raw = str(value).strip()
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
        try:
            dt = email.utils.parsedate_to_datetime(raw)
            if dt is not None:
                return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError, IndexError):
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None
    except (ValueError, TypeError, OverflowError):
        return None


class FeedGuard:
    """소스별 ETag/Last-Modified 캐시, 동일 도메인 예의 간격(jitter), 429/403 6시간 Circuit Breaker."""

    def __init__(
        self,
        meta_path: Optional[Path] = None,
        *,
        jitter_range: tuple[float, float] = DEFAULT_JITTER_RANGE,
        cooldown_hours: float = DEFAULT_COOLDOWN_HOURS,
        sleep_fn: Callable[[float], None] = time.sleep,
        monotonic_fn: Callable[[], float] = time.monotonic,
        now_fn: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        rand_fn: Callable[[float, float], float] = random.uniform,
    ) -> None:
        self.meta_path = Path(meta_path) if meta_path is not None else None
        self.jitter_range = jitter_range
        self.cooldown_hours = cooldown_hours
        self._sleep = sleep_fn
        self._monotonic = monotonic_fn
        self._now = now_fn
        self._rand = rand_fn
        self._lock = threading.Lock()
        self._domain_locks: dict[str, threading.Lock] = {}
        self._domain_last: dict[str, float] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self._extra_meta: dict[str, Any] = {}
        self._dirty = False
        if self.meta_path and self.meta_path.exists():
            self._load()

    def _load(self) -> None:
        assert self.meta_path is not None
        try:
            raw = json.loads(self.meta_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                if isinstance(raw.get("sources"), dict):
                    self.sources = {
                        str(k): dict(v) for k, v in raw["sources"].items() if isinstance(v, dict)
                    }
                self._extra_meta = {
                    k: v for k, v in raw.items() if k not in ("updated_at", "sources")
                }
        except Exception:
            self.sources = {}
            self._extra_meta = {}

    def is_cooling_down(self, url: str) -> Optional[datetime]:
        with self._lock:
            entry = self.sources.get(url)
            until_raw = entry.get("cooldown_until") if entry else None
        until = parse_dt(until_raw)
        if until and self._now() < until:
            return until
        return None

    def conditional_headers(self, url: str) -> dict[str, str]:
        with self._lock:
            entry = self.sources.get(url) or {}
            etag = entry.get("etag")
            last_mod = entry.get("last_modified")
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = str(etag)
        if last_mod:
            headers["If-Modified-Since"] = str(last_mod)
        return headers

    def wait_for_domain(self, url: str) -> None:
        lo, hi = self.jitter_range
        if hi <= 0:
            return
        host = (urlsplit(url).hostname or "").lower()
        if not host:
            return
        with self._lock:
            dlock = self._domain_locks.setdefault(host, threading.Lock())
        with dlock:
            last = self._domain_last.get(host)
            now_mono = self._monotonic()
            if last is not None:
                target_gap = self._rand(lo, hi)
                wait_sec = target_gap - (now_mono - last)
                if wait_sec > 0:
                    self._sleep(wait_sec)
            self._domain_last[host] = self._monotonic()

    def record_response(
        self,
        url: str,
        resp: httpx.Response,
        *,
        source_id: str = "",
        platform_id: str = "",
    ) -> None:
        now = self._now()
        now_iso = now.isoformat().replace("+00:00", "Z")
        with self._lock:
            entry = dict(self.sources.get(url) or {})
            if source_id:
                entry["source_id"] = source_id
            if platform_id:
                entry["platform_id"] = platform_id
            entry["last_status"] = int(resp.status_code)
            entry["last_checked_at"] = now_iso

            if resp.status_code in (403, 429):
                until = (now + timedelta(hours=self.cooldown_hours)).isoformat().replace("+00:00", "Z")
                entry["cooldown_until"] = until
            elif resp.status_code == 304:
                entry["cooldown_until"] = None
                if resp.headers.get("etag"):
                    entry["etag"] = resp.headers["etag"]
                if resp.headers.get("last-modified"):
                    entry["last_modified"] = resp.headers["last-modified"]
            elif 200 <= resp.status_code < 300:
                entry["cooldown_until"] = None
                if resp.headers.get("etag"):
                    entry["etag"] = resp.headers["etag"]
                if resp.headers.get("last-modified"):
                    entry["last_modified"] = resp.headers["last-modified"]
            self.sources[url] = entry
            self._dirty = True

    def save(self) -> None:
        if not self.meta_path or not self._dirty:
            return
        self.meta_path.parent.mkdir(parents=True, exist_ok=True)
        existing_extra: dict[str, Any] = dict(self._extra_meta)
        if self.meta_path.exists():
            try:
                disk = json.loads(self.meta_path.read_text(encoding="utf-8"))
                if isinstance(disk, dict):
                    for k, v in disk.items():
                        if k not in ("updated_at", "sources"):
                            existing_extra[k] = v
            except Exception:
                pass
        payload: dict[str, Any] = {
            "updated_at": self._now().isoformat().replace("+00:00", "Z"),
            "sources": dict(sorted(self.sources.items())),
        }
        payload.update(existing_extra)
        self.meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._dirty = False


class BaseAdapter:
    #: 이 어댑터가 담당하는 sources.endpoint 판별 (registry 에서 사용)
    endpoint_markers: ClassVar[tuple[str, ...]] = ()

    def __init__(self, source: SourceConfig, client: httpx.Client, guard: Optional[FeedGuard] = None) -> None:
        self.source = source
        self.client = client
        self.guard = guard

    @classmethod
    def matches(cls, source: SourceConfig) -> bool:
        return any(m in source.endpoint for m in cls.endpoint_markers)

    def fetch(self) -> list[RawItem]:  # pragma: no cover - 추상 메서드
        raise NotImplementedError

    # ── helpers ─────────────────────────────────────────────────────────────
    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        if self.guard is not None:
            until = self.guard.is_cooling_down(url)
            if until is not None:
                raise CooldownError(f"cooldown until {until.isoformat().replace('+00:00', 'Z')}")
            self.guard.wait_for_domain(url)
            cond = self.guard.conditional_headers(url)
            if cond:
                merged = dict(cond)
                if kwargs.get("headers"):
                    merged.update(kwargs["headers"])
                kwargs["headers"] = merged
            resp = self.client.get(url, **kwargs)
            self.guard.record_response(url, resp, source_id=self.source.id, platform_id=self.source.platform_id)
            if resp.status_code == 304:
                raise NotModifiedError(f"304 Not Modified: {url}")
            resp.raise_for_status()
            return resp

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
