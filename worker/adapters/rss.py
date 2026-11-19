"""범용 RSS/Atom 어댑터 — 공식 블로그(OpenAI, DeepMind) + GitHub Releases Atom."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import feedparser

from adapters.base import BaseAdapter, parse_dt
from collector.classify import classify_news
from collector.models import RawItem
from collector.normalize import strip_html

LOOKBACK_DAYS = 14
MAX_ENTRIES = 20
PRERELEASE_RE = re.compile(r"(?:^|[-._])(rc|alpha|beta|dev|nightly|pre)\d*", re.I)
GH_RELEASES_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/releases")

# 공식 발표는 '반응 수'가 없으므로 고정 가중치 (HN 포인트 환산)
ENGAGEMENT_OFFICIAL_BLOG = 150.0
ENGAGEMENT_RELEASE = 60.0


class RSSAdapter(BaseAdapter):
    """method='rss' 이면서 다른 전용 어댑터에 안 걸리는 모든 소스 (registry 의 마지막 fallback)."""

    @classmethod
    def matches(cls, source) -> bool:
        return source.method == "rss"

    def fetch(self) -> list[RawItem]:
        feed = feedparser.parse(self.get(self.source.endpoint).content)
        if feed.bozo and not feed.entries:
            raise ValueError(f"unparseable feed: {feed.bozo_exception}")

        gh = GH_RELEASES_RE.search(self.source.endpoint)
        cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
        entries = []
        for e in feed.entries:
            published = parse_dt(e.get("published_parsed") or e.get("updated_parsed"))
            if published and published < cutoff:
                continue
            entries.append((published, e))
        entries.sort(key=lambda x: x[0] or cutoff, reverse=True)

        out = []
        for published, e in entries[:MAX_ENTRIES]:
            link, title = e.get("link"), (e.get("title") or "").strip()
            if not link or not title:
                continue
            content = (e.get("content") or [{}])[0].get("value") or e.get("summary") or ""
            if gh:
                tag = link.rstrip("/").rsplit("/", 1)[-1]
                if PRERELEASE_RE.search(tag) or PRERELEASE_RE.search(title):
                    continue                                   # 정식 릴리스만
                repo = gh.group(2)
                if repo.lower() not in title.lower():
                    title = f"{repo} {title}"
                engagement = ENGAGEMENT_RELEASE
            else:
                engagement = ENGAGEMENT_OFFICIAL_BLOG
            out.append(self.item(
                # 릴리스 노트는 소스 기본값 그대로, 공식 블로그는 제목으로 업계/연구 보정
                category=self.source.default_category if gh else classify_news(title, self.source.default_category),
                url=link,
                title=title,
                body=strip_html(content, 4000),
                thumbnail_url=_thumbnail(e),
                metrics={"feed": "github_release" if gh else "official_blog"},
                engagement=engagement,
                published_at=published,
            ))
        return out


def _thumbnail(entry) -> str | None:
    for key in ("media_thumbnail", "media_content"):
        for m in entry.get(key) or []:
            if m.get("url"):
                return m["url"]
    return None
