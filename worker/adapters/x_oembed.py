"""X(트위터) 무과금 하이브리드 수집기.

X 공식 API 는 유료라 쓰지 않는다. 대신
  1) Reddit(r/LocalLLaMA, r/MachineLearning, r/singularity)·Hacker News·하테나·긱뉴스·파이토치 한국 사용자 모임 같은
     공개 커뮤니티 피드에서 사람들이 공유한 `x.com/<handle>/status/<id>` 링크를 찾고
  2) 공식 무료 `publish.twitter.com/oembed` 로 그 트윗의 공개 본문·작성자만 안전하게 가져온다.
  3) oEmbed 가 막히면 환경변수 X_RSS_BRIDGE_BASES (쉼표 구분, `{handle}` 자리표시자 포함 RSS 브리지 URL 템플릿)를
     차례로 시도한다. 예: "https://bridge.example.org/{handle}/rss"
디스커버리 피드 하나·트윗 하나가 실패해도 그 건만 건너뛴다 (try/except 격리).
"""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import feedparser

from adapters.base import BaseAdapter, parse_dt
from collector.models import RawItem
from adapters.rss import ai_relevant
from collector.normalize import strip_html

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "x_discovery.json"
STATUS_RE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d{6,25})")
OEMBED_URL = "https://publish.twitter.com/oembed"
ENGAGEMENT_X = 80.0                     # 커뮤니티에서 공유될 만큼 화제가 된 트윗 (HN 포인트 환산 고정값)
NOT_HANDLES = {"i", "home", "intent", "share", "search", "hashtag"}


def oembed_url(status_url: str) -> str:
    # with_query() 의 첫 인자 이름이 url 이라 쿼리 키 url 과 겹친다 → 직접 조립
    return f"{OEMBED_URL}?{urlencode({'url': status_url, 'omit_script': 'true', 'dnt': 'true'})}"


def load_config(path: Path = CONFIG_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_status_links(text: str) -> list[tuple[str, str, str]]:
    """본문에서 (정규화 URL, handle, status_id) 목록. 같은 트윗은 한 번만."""
    seen: set[str] = set()
    out = []
    for handle, sid in STATUS_RE.findall(text or ""):
        if handle.lower() in NOT_HANDLES or sid in seen:
            continue
        seen.add(sid)
        out.append((f"https://x.com/{handle}/status/{sid}", handle, sid))
    return out


def tweet_text_from_oembed(markup: str) -> str:
    """oEmbed blockquote HTML → 트윗 본문 텍스트 (<p> 안쪽만)."""
    m = re.search(r"<p[^>]*>(.*?)</p>", markup or "", re.S)
    return html.unescape(strip_html(m.group(1) if m else markup or "", 2000)).strip()


def tweet_date_from_oembed(markup: str) -> datetime | None:
    # blockquote 마지막 링크 텍스트가 'November 18, 2026' 같은 날짜
    m = re.search(r">([A-Z][a-z]+ \d{1,2}, \d{4})</a>\s*</blockquote>", markup or "")
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%B %d, %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


class XOEmbedAdapter(BaseAdapter):
    endpoint_markers = ("publish.twitter.com/oembed",)

    def __init__(self, source, client, config: dict | None = None) -> None:
        super().__init__(source, client)
        self.config = config or load_config()
        self.skipped: list[str] = []

    # ── 1) 디스커버리: 커뮤니티 피드에서 status 링크 모으기 ─────────────────────────
    def discover(self) -> list[tuple[str, str, str, str]]:
        """(url, handle, id, 어디서 발견했는지) — 설정 순서대로, 최대 max_tweets 개."""
        found: list[tuple[str, str, str, str]] = []
        seen: set[str] = set()
        for feed in self.config.get("discovery_feeds", []):
            try:
                text = self._feed_text(feed)
            except Exception as e:                       # 피드 하나 실패 → 건너뛰고 계속
                self.skipped.append(f"{feed.get('name', feed.get('url'))}: {type(e).__name__}")
                continue
            for url, handle, sid in extract_status_links(text):
                if sid not in seen:
                    seen.add(sid)
                    found.append((url, handle, sid, feed.get("name", "")))
        return found[: self.config.get("max_tweets", 15)]

    def _feed_text(self, feed: dict) -> str:
        url = feed["url"]
        if feed.get("kind") == "hn_algolia":
            hits = self.get_json(url).get("hits", [])
            return "\n".join(f"{h.get('url') or ''} {h.get('story_text') or ''}" for h in hits)
        parsed = feedparser.parse(self.get(url).content)
        parts = []
        for e in parsed.entries[: feed.get("max_entries", 40)]:
            content = (e.get("content") or [{}])[0].get("value") or e.get("summary") or ""
            parts.append(f"{e.get('link', '')} {content}")
        return "\n".join(parts)

    # ── 2) 본문: 공식 oEmbed → 3) RSS 브리지 폴백 ─────────────────────────────────
    def fetch_tweet(self, url: str, handle: str, sid: str) -> tuple[str, str, datetime | None] | None:
        try:
            data = self.get_json(oembed_url(url))
            text = tweet_text_from_oembed(data.get("html", ""))
            if text:
                return text, data.get("author_name") or handle, tweet_date_from_oembed(data.get("html", ""))
        except Exception as e:
            self.skipped.append(f"oembed {sid}: {type(e).__name__}")
        for base in [b.strip() for b in os.getenv("X_RSS_BRIDGE_BASES", "").split(",") if b.strip()]:
            try:
                parsed = feedparser.parse(self.get(base.replace("{handle}", handle)).content)
                for e in parsed.entries:
                    if sid in (e.get("link") or "") or sid in (e.get("id") or ""):
                        body = strip_html((e.get("summary") or e.get("title") or ""), 2000)
                        return body, handle, parse_dt(e.get("published_parsed"))
            except Exception as e:
                self.skipped.append(f"bridge {sid}: {type(e).__name__}")
        return None

    def fetch(self) -> list[RawItem]:
        out: list[RawItem] = []
        for url, handle, sid, via in self.discover():
            got = self.fetch_tweet(url, handle, sid)
            if not got:
                continue
            text, author, published = got
            if re.fullmatch(r"(?:https?://t\.co/\S+\s*)+", text.strip()):
                continue                                 # 링크만 있는 트윗은 본문이 없어 건너뜀
            if self.config.get("require_ai", True) and not ai_relevant(text):
                continue                                 # AI 와 무관한 화제 트윗(보안·금융·사고 속보 등) 제외
            title = re.sub(r"\s+", " ", text)
            title = f"@{handle}: {title[:110]}{'…' if len(title) > 110 else ''}"
            out.append(self.item(
                category="social",
                url=url,
                title=title,
                body=text,
                metrics={"feed": "x_oembed", "author": author, "discovered_via": via},
                engagement=ENGAGEMENT_X,
                published_at=published,
            ))
        return out
