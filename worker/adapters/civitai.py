"""Civitai — 안전 등급 필터 '이중' 강제.

1) 엔드포인트에 nsfw=false 가 없으면 아예 호출하지 않는다 (DB CHECK 제약과 동일 규칙).
2) 응답을 다시 거른다. 실측 결과 nsfw=false 응답에도 성인 등급 이미지가 섞인 모델(nsfwLevel 비트마스크)이
   대부분이라, 모델/버전 nsfwLevel 이 PG·PG-13 비트(1|2) 외의 값을 하나라도 가지면 버린다.
3) 썸네일은 nsfwLevel == 1(PG) 이미지만 사용. 실존 인물(poi)·미성년(minor) 플래그·금칙어 이름도 제외.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from adapters.base import BaseAdapter, parse_dt, with_query
from collector.models import RawItem
from collector.normalize import strip_html

SAFE_LEVEL_MASK = 1 | 2          # PG(1), PG-13(2). R(4)/X(8)/XXX(16)/Blocked(32) 비트가 있으면 제외
BLOCKED_NAME_RE = re.compile(
    r"\b(nsfw|nude|nudity|naked|hentai|porn|sex\w*|lewd|erotic\w*|lingerie|bikini|babes?|boobs?|breasts?|"
    r"ass|butt|thicc|onlyfans|fetish|bdsm|harem|ecchi|ahegao|waifu|gravure|panties|underwear)\b",
    re.I,
)
FETCH_LIMIT = 100                # 필터 통과율이 낮아서 넉넉히 받아 거른다


class UnsafeEndpointError(ValueError):
    pass


def assert_safe_endpoint(endpoint: str) -> None:
    values = parse_qs(urlsplit(endpoint).query).get("nsfw", [])
    if values != ["false"]:
        raise UnsafeEndpointError(f"Civitai endpoint must contain nsfw=false: {endpoint}")


def is_safe_level(level) -> bool:
    try:
        return (int(level or 0) & ~SAFE_LEVEL_MASK) == 0
    except (TypeError, ValueError):
        return False


def is_safe_model(m: dict) -> bool:
    if m.get("nsfw") is not False:                       # 명시적으로 False 인 것만
        return False
    if m.get("poi") or m.get("minor"):
        return False
    if not is_safe_level(m.get("nsfwLevel")):
        return False
    versions = m.get("modelVersions") or []
    if versions and not is_safe_level(versions[0].get("nsfwLevel")):
        return False
    text = " ".join([m.get("name") or "", " ".join(m.get("tags") or [])])
    return not BLOCKED_NAME_RE.search(text)


def safe_thumbnail(m: dict) -> str | None:
    for v in (m.get("modelVersions") or [])[:1]:
        for img in v.get("images") or []:
            if img.get("nsfwLevel") == 1 and img.get("type", "image") == "image" and img.get("url"):
                return img["url"]
    return None


class CivitaiAdapter(BaseAdapter):
    endpoint_markers = ("civitai.com/api",)

    def fetch(self) -> list[RawItem]:
        assert_safe_endpoint(self.source.endpoint)
        url = with_query(self.source.endpoint, limit=FETCH_LIMIT, nsfw="false")
        out = []
        for m in self.get_json(url).get("items", []):
            if not is_safe_model(m):
                continue
            stats = m.get("stats") or {}
            version = (m.get("modelVersions") or [{}])[0]
            thumbs = int(stats.get("thumbsUpCount") or 0)
            body = (
                f"Civitai community {m.get('type', 'model')} '{m.get('name')}'. "
                f"Base model: {version.get('baseModel') or 'unknown'}. Tags: {', '.join((m.get('tags') or [])[:12])}. "
                f"Downloads: {stats.get('downloadCount', 0)}. Thumbs up: {thumbs}.\n"
                f"{strip_html(m.get('description') or '', 2500)}"
            )
            out.append(self.item(
                url=f"https://civitai.com/models/{m['id']}",
                title=f"{m.get('name', '').strip()} ({m.get('type', 'Model')})",
                body=body,
                thumbnail_url=safe_thumbnail(m),
                metrics={"downloads": stats.get("downloadCount", 0), "thumbs_up": thumbs,
                         "type": m.get("type"), "base_model": version.get("baseModel"),
                         "nsfw_level": m.get("nsfwLevel")},
                engagement=thumbs * 0.05,          # 좋아요 20 ≈ HN 1점
                published_at=parse_dt(version.get("publishedAt") or m.get("publishedAt")),
            ))
        return out
