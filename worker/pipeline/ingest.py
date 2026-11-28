"""15분 심층 스냅샷을 Cloudflare 엣지 D1 로 밀어 넣는다 (POST /api/live-feed/ingest).

본문 = 1행 작은 메타 JSON + "\\n" + live-feed.json 전체 텍스트.
Worker 는 큰 JSON 을 파싱하지 않고 items 배열 본문만 잘라 저장한다 (CPU 1102 방지).
url_key / title_key 는 web/edge/feed-store.ts 의 urlKey / titleKey 와 같은 규칙이어야 한다.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("ai_radar.ingest")
TITLE_STRIP_RE = re.compile(r"[^0-9a-z가-힣]")
TITLE_SOURCE_SUFFIX_RE = re.compile(r"\s+-\s+[^-]{1,40}$")


def url_key(raw: str) -> str:
    try:
        u = urlsplit(raw)
        host = re.sub(r"^www\.", "", (u.hostname or "").lower())
        path = re.sub(r"/+$", "", u.path)
        q = f"?{u.query}" if host == "news.ycombinator.com" and u.query else ""
        return f"{host}{path}{q}"
    except ValueError:
        return raw.strip().lower()


def title_key(title: str) -> str:
    norm = TITLE_STRIP_RE.sub("", TITLE_SOURCE_SUFFIX_RE.sub("", (title or "").lower()))
    return f"t:{norm[:28]}" if len(norm) >= 8 else ""


def ingest_keys(items: list[dict[str, Any]]) -> list[str]:
    keys: list[str] = []
    for it in items:
        keys.append(url_key(str(it.get("canonical_url") or "")))
        for t in (it.get("original_title"), it.get("hook_title")):
            k = title_key(str(t or ""))
            if k:
                keys.append(k)
    return list(dict.fromkeys(k for k in keys if k))


def push_snapshot(snapshot_path: Path, *, url: Optional[str] = None, secret: Optional[str] = None,
                  client: Optional[httpx.Client] = None) -> Optional[dict[str, Any]]:
    url = url or os.getenv("FEED_INGEST_URL", "").strip()
    secret = secret or os.getenv("FEED_INGEST_SECRET", "").strip()
    if not url or not secret or not snapshot_path.exists():
        return None
    text = snapshot_path.read_text(encoding="utf-8")
    payload = json.loads(text)
    items = payload.get("items") or []
    meta = {"generated_at": payload.get("generated_at"), "count": len(items), "urls": ingest_keys(items)}
    body = json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n" + text
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))
    try:
        resp = client.post(url, content=body.encode("utf-8"),
                           headers={"Authorization": f"Bearer {secret}", "Content-Type": "text/plain; charset=utf-8"})
        if resp.status_code != 200:
            logger.warning("edge ingest failed: HTTP %s", resp.status_code)
            return None
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("edge ingest failed: %s", type(e).__name__)
        return None
    finally:
        if own:
            client.close()
