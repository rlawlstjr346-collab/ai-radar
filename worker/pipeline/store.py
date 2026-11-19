"""저장소 2종: MemoryStore(--dry-run / 테스트) · SupabaseStore(운영, service_role 키).

두 저장소는 같은 메서드를 가진다 → runner 는 어느 쪽인지 모른다.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from collector.models import SourceConfig
from pipeline.merge import Candidate, merge_into_existing, new_item_row

log = logging.getLogger("ai_radar.store")

SEED_SQL = Path(__file__).resolve().parents[2] / "supabase" / "seed" / "seed_platforms.sql"

# seed_platforms.sql 의 sources VALUES 튜플 파서 (dry-run 이 DB 없이도 같은 소스 목록을 쓰도록)
_SOURCE_TUPLE_RE = re.compile(
    r"\(\s*'([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)',\s*(?:--[^\n]*\n\s*)?'(api|rss)',\s*'(\w+)',\s*(true|false)\s*\)",
)
_PLATFORM_RE = re.compile(
    r"^\('([a-z0-9-]+)',\s*'([^']+)',\s*'(llm_chat|dev|image_design|video_audio|research|industry|social)',", re.M
)


def load_seed_sources(path: Path = SEED_SQL) -> list[SourceConfig]:
    sql = path.read_text(encoding="utf-8")
    block = sql.split("insert into public.sources", 1)[1]
    sources = []
    for i, (pid, name, endpoint, method, cat, enabled) in enumerate(_SOURCE_TUPLE_RE.findall(block)):
        sources.append(SourceConfig(
            id=f"seed-{i:02d}-{pid}", platform_id=pid, name=name, endpoint=endpoint, method=method,
            default_category=cat, is_enabled=(enabled == "true"), platform_status="active",
        ))
    return sources


def load_seed_platform_names(path: Path = SEED_SQL) -> dict[str, str]:
    sql = path.read_text(encoding="utf-8").split("insert into public.sources", 1)[0]
    return {pid: name for pid, name, _ in _PLATFORM_RE.findall(sql)}


class MemoryStore:
    def __init__(self, sources: Optional[list[SourceConfig]] = None,
                 platform_names: Optional[dict[str, str]] = None) -> None:
        self.sources = sources if sources is not None else load_seed_sources()
        self.names = platform_names if platform_names is not None else load_seed_platform_names()
        self.items: dict[str, dict] = {}            # dedup_key -> row
        self.summaries: dict[str, dict] = {}        # item_id -> row
        self.glossary: dict[str, dict] = {}
        self.health: dict[str, dict] = {}

    def load_sources(self) -> list[SourceConfig]:
        return [s for s in self.sources if s.is_enabled]

    def platform_names(self) -> dict[str, str]:
        return self.names

    def persist(self, candidates: list[Candidate]) -> dict:
        stats = {"inserted": 0, "merged": 0, "skipped": 0}
        now = datetime.now(timezone.utc)
        urls = {r["canonical_url"] for r in self.items.values()}
        for c in candidates:
            row = self.items.get(c.dedup_key)
            if row:
                row.update(merge_into_existing(row, c, now))
                stats["merged"] += 1
            elif c.canonical_url in urls:
                stats["skipped"] += 1                   # canonical_url unique 충돌
            else:
                self.items[c.dedup_key] = {"id": str(uuid.uuid4()), "created_at": now.isoformat(),
                                           "lifecycle_status": "hot", **new_item_row(c, now)}
                urls.add(c.canonical_url)
                stats["inserted"] += 1
        return stats

    def record_success(self, source: SourceConfig) -> None:
        self.health[source.id] = {"fail_count": 0, "last_success_at": datetime.now(timezone.utc).isoformat()}

    def record_failure(self, source: SourceConfig) -> None:
        prev = self.health.get(source.id, {}).get("fail_count", source.fail_count)
        self.health[source.id] = {"fail_count": prev + 1}

    def summaries_created_today(self) -> int:
        return len(self.summaries)

    def top_unsummarized(self, n: int) -> list[dict]:
        rows = [r for r in self.items.values()
                if r["id"] not in self.summaries and r["lifecycle_status"] == "hot"]
        return sorted(rows, key=lambda r: (r["created_at"], r["importance_score"]), reverse=True)[:n]

    def fetch_glossary(self) -> list[dict]:
        return list(self.glossary.values())

    def save_summary(self, item_id: str, result) -> None:
        self.summaries[item_id] = result.to_summary_row(item_id)
        for g in result.to_glossary_rows():
            self.glossary.setdefault(g["term"], g)

    def apply_lifecycle(self) -> dict:
        return {"warmed": 0, "archived": 0}


class SupabaseStore:
    CHUNK = 100

    def __init__(self, sb: Any) -> None:
        self.sb = sb
        self._names: Optional[dict[str, str]] = None

    @classmethod
    def from_env(cls) -> "SupabaseStore":
        import os
        from supabase import create_client
        return cls(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]))

    def load_sources(self) -> list[SourceConfig]:
        rows = (self.sb.table("sources").select("*, platforms(collect_status)")
                .eq("is_enabled", True).execute().data) or []
        out = []
        for r in rows:
            platform = r.pop("platforms", None) or {}
            out.append(SourceConfig(**{k: r[k] for k in SourceConfig.model_fields if k in r},
                                    platform_status=platform.get("collect_status")))
        return out

    def platform_names(self) -> dict[str, str]:
        if self._names is None:
            rows = self.sb.table("platforms").select("id,name").execute().data or []
            self._names = {r["id"]: r["name"] for r in rows}
        return self._names

    def persist(self, candidates: list[Candidate]) -> dict:
        stats = {"inserted": 0, "merged": 0, "skipped": 0}
        now = datetime.now(timezone.utc)
        by_key = {c.dedup_key: c for c in candidates}
        keys = list(by_key)
        existing: dict[str, dict] = {}
        for i in range(0, len(keys), self.CHUNK):
            rows = (self.sb.table("items")
                    .select("id,source_id,dedup_key,metrics_json,thumbnail_url,published_at,raw_body")
                    .in_("dedup_key", keys[i:i + self.CHUNK]).execute().data) or []
            existing.update({r["dedup_key"]: r for r in rows})

        for key, row in existing.items():
            self.sb.table("items").update(merge_into_existing(row, by_key[key], now)).eq("id", row["id"]).execute()
            stats["merged"] += 1

        new_rows = [new_item_row(c, now) for k, c in by_key.items() if k not in existing]
        for i in range(0, len(new_rows), self.CHUNK):
            chunk = new_rows[i:i + self.CHUNK]
            try:
                self.sb.table("items").insert(chunk).execute()
                stats["inserted"] += len(chunk)
            except Exception:                             # canonical_url 충돌 등 → 한 건씩 재시도
                for row in chunk:
                    try:
                        self.sb.table("items").insert(row).execute()
                        stats["inserted"] += 1
                    except Exception as e:
                        log.warning("skip item %s: %s", row["canonical_url"], e)
                        stats["skipped"] += 1
        return stats

    def record_success(self, source: SourceConfig) -> None:
        self.sb.table("sources").update(
            {"fail_count": 0, "last_success_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", source.id).execute()
        if source.platform_status == "paused":            # 다시 살아났으면 플랫폼 상태도 회복
            self.sb.table("platforms").update({"collect_status": "active"}).eq("id", source.platform_id).execute()

    def record_failure(self, source: SourceConfig) -> None:
        # fail_count 가 3 에 도달하면 DB 트리거가 platforms.collect_status 를 paused 로 전환
        self.sb.table("sources").update({"fail_count": source.fail_count + 1}).eq("id", source.id).execute()

    def summaries_created_today(self) -> int:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        res = (self.sb.table("summaries").select("item_id", count="exact")
               .gte("created_at", start).limit(1).execute())
        return res.count or 0

    def top_unsummarized(self, n: int) -> list[dict]:
        res = (self.sb.table("items")
               .select("id,platform_id,category,original_title,canonical_url,metrics_json,importance_score,"
                       "created_at,source_id,sources(name),summaries(item_id)")
               .is_("summaries", "null")
               .eq("lifecycle_status", "hot")                  # 메인 피드(0~7일) 대상만 요약
               .order("created_at", desc=True)                 # 최근 유입분 위주로 후보 풀 구성
               .order("importance_score", desc=True)
               .limit(n).execute())
        return res.data or []

    def fetch_glossary(self) -> list[dict]:
        from summarizer import fetch_glossary
        return fetch_glossary(self.sb)

    def save_summary(self, item_id: str, result) -> None:
        from summarizer import save_summary
        save_summary(self.sb, item_id, result)

    def apply_lifecycle(self) -> dict:
        data = self.sb.rpc("apply_item_lifecycle").execute().data
        return (data or [{}])[0] if isinstance(data, list) else (data or {})
