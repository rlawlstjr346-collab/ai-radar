"""Anthropic — 공식 RSS 가 없어서 공식 sitemap.xml 의 /news/, /research/ 경로만 읽는다.

HTML 본문 스크래핑은 하지 않는다 (깨지기 쉬움). 제목은 URL slug 에서 만들고 본문은 비워 둔다.
lastmod 는 '수정 시각'이라 발행일과 다를 수 있음 → 최근 LOOKBACK_DAYS 내 수정분만, dedup 으로 중복 방지.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

from adapters.base import BaseAdapter, parse_dt
from collector.models import RawItem

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
PATH_RE = re.compile(r"^https://(?:www\.)?anthropic\.com/(news|research)/([^/?#]+)/?$")
LOOKBACK_DAYS = 7
MAX_ENTRIES = 15
ENGAGEMENT_OFFICIAL = 150.0
ACRONYMS = {"ai", "api", "llm", "ipo", "rsp", "mcp", "us", "uk", "eu", "ceo", "cbrn", "gpu", "tpu"}


def title_from_slug(slug: str) -> str:
    words = re.split(r"[-_]+", slug)
    return " ".join(w.upper() if w.lower() in ACRONYMS else (w if any(c.isupper() for c in w) else w.capitalize())
                    for w in words if w)


class AnthropicSitemapAdapter(BaseAdapter):
    endpoint_markers = ("anthropic.com/sitemap",)

    def fetch(self) -> list[RawItem]:
        root = ET.fromstring(self.get(self.source.endpoint).content)
        cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
        rows = []
        for url_el in root.findall("sm:url", NS):
            loc = (url_el.findtext("sm:loc", default="", namespaces=NS) or "").strip()
            m = PATH_RE.match(loc)
            if not m:
                continue
            lastmod = parse_dt(url_el.findtext("sm:lastmod", default="", namespaces=NS))
            if not lastmod or lastmod < cutoff:
                continue
            rows.append((lastmod, m.group(1), m.group(2), loc))
        rows.sort(reverse=True)

        return [
            self.item(
                category="research" if section == "research" else self.source.default_category,
                url=loc,
                title=f"Anthropic {section.capitalize()}: {title_from_slug(slug)}",
                body=(f"Official Anthropic {section} page at {loc}. Only the URL title is available "
                      "(no article text was collected)."),
                metrics={"section": section, "lastmod": lastmod.isoformat()},
                engagement=ENGAGEMENT_OFFICIAL,
                published_at=lastmod,
            )
            for lastmod, section, slug, loc in rows[:MAX_ENTRIES]
        ]
