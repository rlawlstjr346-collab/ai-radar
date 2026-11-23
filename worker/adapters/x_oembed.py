"""X(트위터) 0원 다중 폴백 실시간 수집기 (매 20분 실행).

X 유료 공식 API(api.twitter.com / api.x.com)는 절대 호출하지 않는다. 대신 아래 3개 경로를
병렬(timeout 5초, 개별 실패 격리)로 결합해 글로벌 AI 공식 계정 및 인디해커·AI 빌더의
신규 서비스 런칭·데모·오픈소스 공개 포스트를 포착한다:
  1) X Syndication 공개 임베드 타임라인(syndication.twitter.com) — 주요 AI 공식·빌더 계정
  2) 가용 Nitter / RSS 브리지 인스턴스 자동 순회 (환경변수 X_RSS_BRIDGE_BASES + 내장 목록)
  3) Hacker News · GeekNews · Product Hunt · Reddit · 뉴스레터 내 화제의 x.com/twitter.com 링크
     역추적 → 공식 무료 publish.twitter.com/oembed 로 본문·작성자·날짜 추출
"""

from __future__ import annotations

import html
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import feedparser

from adapters.base import BaseAdapter, parse_dt
from adapters.rss import ai_relevant
from collector.models import RawItem
from collector.normalize import strip_html

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "x_discovery.json"
STATUS_RE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d{6,25})")
OEMBED_URL = "https://publish.twitter.com/oembed"
SYNDICATION_PROFILE_URL = "https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}"
NEXT_DATA_RE = re.compile(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.S | re.I)

ENGAGEMENT_X = 140.0
DEFAULT_REQUEST_TIMEOUT = 5.0
NOT_HANDLES = {"i", "home", "intent", "share", "search", "hashtag"}

# 공식 AI 연구소·핵심 개발 도구 계정 (런칭·업데이트·오픈소스 신호 감지용)
CORE_AI_ACCOUNTS = {
    "openai", "anthropicai", "googledeepmind", "xai", "cursor_ai", "vercel", "v0",
    "supabase", "huggingface", "perplexity_ai", "langchainai", "ollama", "mistralai",
    "deepseek_ai", "alibaba_qwen", "karpathy", "simonw", "levelsio", "rauchg", "swyx",
}

LAUNCH_SIGNAL_RE = re.compile(
    r"\b(launch(?:ed|ing)?|introduc(?:e|ed|ing)|announc(?:e|ed|ing)|releas(?:e|ed|ing)|shipp(?:ed|ing)|"
    r"open[- ]sourc\w*|demo|preview|beta|v\d+\.\d+|api|sdk|mcp|agent|model|benchmark|github\.com|"
    r"built|build|app|web ?app|tool|workflow|plugin|cli|extension|출시|공개|오픈소스|런칭|데모)\b",
    re.I,
)

# 노이즈 필터: 단순 리트윗, 잡담, 밈, 광고/홍보/에어드롭 차단
NOISE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*RT\s+@", re.I),
    re.compile(r"^\s*(?:gm|gn|good morning|good night|lol|lmao|haha|this\.|agreed\.?|same\.?|nice\.?|wow\.?|congrats!?|thank you!?|thanks!?)\s*$", re.I),
    re.compile(r"\b(giveaway|airdrop|whitelist|presale|memecoin|crypto\s*signal|dm\s+me\s+for|follow\s+and\s+retweet|repost\s+to\s+win|promo\s+code|discount\s+code|limited\s+slots|sponsored)\b", re.I),
    re.compile(r"(독서\s*모임\s*모집|스터디\s*모집|채용\s*공고|할인\s*쿠폰|무료\s*특강\s*모집|선착순\s*모집)", re.I),
)
URL_ONLY_RE = re.compile(r"(?:https?://\S+\s*)+")
MENTION_PREFIX_RE = re.compile(r"^(?:@[A-Za-z0-9_]+\s+)+")


def oembed_url(status_url: str) -> str:
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
    m = re.search(r">([A-Z][a-z]+ \d{1,2}, \d{4})</a>\s*</blockquote>", markup or "")
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%B %d, %Y").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        # oEmbed 는 날짜만(00:00Z) 주므로, 오늘 작성된 트윗이면 현재 시각 - 15분으로 보정해 과도한 노후화 방지
        if dt.date() == now.date():
            return max(dt, now - timedelta(minutes=15))
        return dt
    except ValueError:
        return None


def is_noisy_x_post(text: str, *, is_official_account: bool = False) -> bool:
    """잡담·밈·단순 리트윗·링크뿐인 글·광고/모객 포스트 차단."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return True
    if URL_ONLY_RE.fullmatch(cleaned):
        return True
    for pat in NOISE_PATTERNS:
        if pat.search(cleaned):
            return True
    # 본문에서 URL과 맨 앞 멘션을 제거한 실질 텍스트 길이 검사
    substance = re.sub(r"https?://\S+", "", cleaned)
    substance = MENTION_PREFIX_RE.sub("", substance).strip()
    min_len = 20 if is_official_account else 26
    if len(substance) < min_len:
        return True
    # 단순 멘션 답글(@someone ...)은 런칭/AI 신호가 분명할 때만 허용
    if cleaned.startswith("@") and not LAUNCH_SIGNAL_RE.search(substance):
        return True
    return False


def parse_syndication_timeline(html_body: str, fallback_handle: str) -> list[dict[str, Any]]:
    """syndication.twitter.com 임베드 타임라인 HTML(__NEXT_DATA__)에서 공개 트윗 목록 추출."""
    m = NEXT_DATA_RE.search(html_body or "")
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return []
    entries = (
        (((data.get("props") or {}).get("pageProps") or {}).get("timeline") or {}).get("entries")
        or []
    )
    posts: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        tweet = ((entry.get("content") or {}).get("tweet")) if isinstance(entry.get("content"), dict) else None
        if not isinstance(tweet, dict):
            continue
        # 단순 리트윗·답글 제외
        if tweet.get("retweeted_status") or tweet.get("in_reply_to_status_id_str"):
            continue
        sid = str(tweet.get("id_str") or tweet.get("id") or "").strip()
        text = html.unescape(str(tweet.get("full_text") or tweet.get("text") or "")).strip()
        if not sid or not text:
            continue
        user = tweet.get("user") if isinstance(tweet.get("user"), dict) else {}
        handle = str(user.get("screen_name") or fallback_handle).strip()
        author = str(user.get("name") or handle).strip()
        created = parse_dt(tweet.get("created_at"))
        likes = int(tweet.get("favorite_count") or 0)
        retweets = int(tweet.get("retweet_count") or 0)
        posts.append({
            "sid": sid,
            "handle": handle,
            "author": author,
            "url": f"https://x.com/{handle}/status/{sid}",
            "text": text,
            "published_at": created,
            "engagement": max(ENGAGEMENT_X, float(likes + retweets * 2)),
        })
    return posts


class XOEmbedAdapter(BaseAdapter):
    endpoint_markers = ("publish.twitter.com/oembed",)

    def __init__(self, source, client, config: dict | None = None, guard=None) -> None:
        super().__init__(source, client, guard=guard)
        self.config = config if config is not None else load_config()
        self.skipped: list[str] = []
        self._timeout = float(self.config.get("per_request_timeout", DEFAULT_REQUEST_TIMEOUT))

    def _bridge_templates(self) -> list[str]:
        env_bases = [b.strip() for b in os.getenv("X_RSS_BRIDGE_BASES", "").split(",") if b.strip()]
        cfg_bases = [b.strip() for b in self.config.get("nitter_instances", []) if isinstance(b, str) and b.strip()]
        seen: set[str] = set()
        out: list[str] = []
        for b in [*env_bases, *cfg_bases]:
            if b not in seen:
                seen.add(b)
                out.append(b)
        return out

    # ── 경로 1: X Syndication 공개 타임라인 ────────────────────────────────────────
    def _fetch_syndication_account(self, handle: str) -> list[dict[str, Any]]:
        url = SYNDICATION_PROFILE_URL.format(handle=handle)
        resp = self.client.get(
            url,
            timeout=self._timeout,
            headers={"Accept": "text/html,application/xhtml+xml"},
        )
        resp.raise_for_status()
        return parse_syndication_timeline(resp.text, handle)

    def _collect_via_syndication(self, accounts: list[str]) -> list[tuple[str, str, str, str, str, datetime | None, float, str]]:
        """성공한 계정에서 (url, handle, sid, text, author, published, engagement, via) 수집."""
        if not accounts:
            return []
        collected: list[tuple[str, str, str, str, str, datetime | None, float, str]] = []
        # 첫 번째 계정으로 Syndication 가용성을 빠르게 확인하고, 막혀 있으면 나머지 계정 폭격 없이 즉시 중단
        consecutive_fail = 0
        with ThreadPoolExecutor(max_workers=min(6, len(accounts))) as pool:
            futs = {pool.submit(self._fetch_syndication_account, h): h for h in accounts}
            for fut in as_completed(futs):
                h = futs[fut]
                try:
                    posts = fut.result()
                    if posts:
                        consecutive_fail = 0
                    for p in posts[:4]:
                        collected.append((
                            p["url"], p["handle"], p["sid"], p["text"], p["author"],
                            p["published_at"], p["engagement"], "X Syndication",
                        ))
                except Exception as e:
                    consecutive_fail += 1
                    self.skipped.append(f"syndication @{h}: {type(e).__name__}")
        return collected

    # ── 경로 2: 가용 Nitter / RSS 브리지 인스턴스 자동 순회 ────────────────────────
    def _collect_via_bridges(self, accounts: list[str]) -> list[tuple[str, str, str, str, str, datetime | None, float, str]]:
        templates = self._bridge_templates()
        if not accounts or not templates:
            return []
        # 1) 프로브: 첫 계정으로 살아있는 브리지 인스턴스 하나를 5초 타임아웃 내로 찾는다
        working_tpl: str | None = None
        for tpl in templates:
            probe_url = tpl.replace("{handle}", accounts[0])
            try:
                resp = self.client.get(probe_url, timeout=self._timeout)
                if resp.status_code == 200:
                    parsed = feedparser.parse(resp.content)
                    if parsed.entries:
                        working_tpl = tpl
                        break
            except Exception as e:
                self.skipped.append(f"bridge probe {tpl}: {type(e).__name__}")
        if not working_tpl:
            return []

        collected: list[tuple[str, str, str, str, str, datetime | None, float, str]] = []

        def fetch_one(handle: str) -> list[tuple[str, str, str, str, str, datetime | None, float, str]]:
            feed_url = working_tpl.replace("{handle}", handle)
            resp = self.client.get(feed_url, timeout=self._timeout)
            resp.raise_for_status()
            parsed = feedparser.parse(resp.content)
            rows = []
            for e in parsed.entries[:5]:
                link = str(e.get("link") or "")
                m = re.search(r"/status(?:es)?/(\d{6,25})", link)
                if not m:
                    continue
                sid = m.group(1)
                raw_title = str(e.get("title") or "").strip()
                raw_summary = strip_html(e.get("summary") or "", 1800)
                body = raw_summary if len(raw_summary) >= len(raw_title) else raw_title
                if not body:
                    continue
                pub = parse_dt(e.get("published_parsed")) or parse_dt(e.get("published"))
                rows.append((
                    f"https://x.com/{handle}/status/{sid}",
                    handle,
                    sid,
                    body,
                    handle,
                    pub,
                    ENGAGEMENT_X,
                    "X RSS Bridge",
                ))
            return rows

        with ThreadPoolExecutor(max_workers=min(4, len(accounts))) as pool:
            futs = {pool.submit(fetch_one, h): h for h in accounts[:12]}
            for fut in as_completed(futs):
                h = futs[fut]
                try:
                    collected.extend(fut.result())
                except Exception as e:
                    self.skipped.append(f"bridge @{h}: {type(e).__name__}")
        return collected

    # ── 경로 3: 커뮤니티 피드에서 x.com/twitter.com 링크 역추적 + 공식 oEmbed ──────
    def discover(self) -> list[tuple[str, str, str, str]]:
        """(url, handle, id, 어디서 발견했는지) — 병렬 수집, 설정 순서 보존, 최대 max_tweets 개."""
        feeds = self.config.get("discovery_feeds", [])
        if not feeds:
            return []
        results_by_idx: dict[int, list[tuple[str, str, str, str]]] = {}

        def scan_feed(idx: int, feed: dict) -> tuple[int, list[tuple[str, str, str, str]]]:
            text = self._feed_text(feed)
            links = extract_status_links(text)
            via = feed.get("name", "")
            return idx, [(url, handle, sid, via) for url, handle, sid in links]

        with ThreadPoolExecutor(max_workers=min(8, len(feeds))) as pool:
            futs = {pool.submit(scan_feed, i, feed): (i, feed) for i, feed in enumerate(feeds)}
            for fut in as_completed(futs):
                i, feed = futs[fut]
                try:
                    idx, rows = fut.result()
                    results_by_idx[idx] = rows
                except Exception as e:
                    self.skipped.append(f"{feed.get('name', feed.get('url'))}: {type(e).__name__}")

        found: list[tuple[str, str, str, str]] = []
        seen: set[str] = set()
        for i in range(len(feeds)):
            for url, handle, sid, via in results_by_idx.get(i, []):
                if sid not in seen:
                    seen.add(sid)
                    found.append((url, handle, sid, via))
        return found[: self.config.get("max_tweets", 45)]

    def _feed_text(self, feed: dict) -> str:
        url = feed["url"]
        if feed.get("kind") == "hn_algolia":
            hits = self.get_json(url, timeout=self._timeout).get("hits", [])
            return "\n".join(f"{h.get('url') or ''} {h.get('story_text') or ''}" for h in hits)
        parsed = feedparser.parse(self.get(url, timeout=self._timeout).content)
        parts = []
        for e in parsed.entries[: feed.get("max_entries", 40)]:
            content = (e.get("content") or [{}])[0].get("value") or e.get("summary") or ""
            parts.append(f"{e.get('link', '')} {content}")
        return "\n".join(parts)

    def fetch_tweet(self, url: str, handle: str, sid: str) -> tuple[str, str, datetime | None] | None:
        try:
            data = self.get_json(oembed_url(url), timeout=self._timeout)
            text = tweet_text_from_oembed(data.get("html", ""))
            if text:
                return text, data.get("author_name") or handle, tweet_date_from_oembed(data.get("html", ""))
        except Exception as e:
            self.skipped.append(f"oembed {sid}: {type(e).__name__}")
        for base in [b.strip() for b in os.getenv("X_RSS_BRIDGE_BASES", "").split(",") if b.strip()]:
            try:
                parsed = feedparser.parse(self.get(base.replace("{handle}", handle), timeout=self._timeout).content)
                for e in parsed.entries:
                    if sid in (e.get("link") or "") or sid in (e.get("id") or ""):
                        body = strip_html((e.get("summary") or e.get("title") or ""), 2000)
                        return body, handle, parse_dt(e.get("published_parsed"))
            except Exception as e:
                self.skipped.append(f"bridge {sid}: {type(e).__name__}")
        return None

    def _accept_and_build(
        self,
        *,
        url: str,
        handle: str,
        sid: str,
        text: str,
        author: str,
        published: datetime | None,
        engagement: float,
        via: str,
        cutoff: datetime | None,
    ) -> RawItem | None:
        is_official = handle.lower() in CORE_AI_ACCOUNTS
        if is_noisy_x_post(text, is_official_account=is_official):
            return None
        if published and cutoff and published < cutoff:
            return None
        if self.config.get("require_ai", True):
            if not ai_relevant(text) and not (is_official and LAUNCH_SIGNAL_RE.search(text)):
                return None
        clean_title_body = re.sub(r"\s+", " ", text).strip()
        title = f"@{handle}: {clean_title_body[:110]}{'…' if len(clean_title_body) > 110 else ''}"
        return self.item(
            category="social",
            url=url,
            title=title,
            body=text,
            metrics={
                "feed": "x_oembed",
                "author": author,
                "author_handle": f"@{handle}",
                "discovered_via": via,
                "status_id": sid,
            },
            engagement=engagement,
            published_at=published,
        )

    def fetch(self) -> list[RawItem]:
        max_tweets = int(self.config.get("max_tweets", 45))
        lookback_h = self.config.get("lookback_hours")
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=float(lookback_h))) if lookback_h else None
        accounts = [a.strip().lstrip("@") for a in self.config.get("target_accounts", []) if isinstance(a, str) and a.strip()]

        out: list[RawItem] = []
        seen_sids: set[str] = set()

        # 1) 커뮤니티 역추적 + 공식 oEmbed (가장 신뢰도 높은 0원 경로)
        discovered = self.discover()
        if discovered:
            oembed_results: dict[int, tuple[str, str, datetime | None] | None] = {}
            with ThreadPoolExecutor(max_workers=min(8, len(discovered))) as pool:
                futs = {
                    pool.submit(self.fetch_tweet, url, handle, sid): i
                    for i, (url, handle, sid, _via) in enumerate(discovered)
                }
                for fut in as_completed(futs):
                    i = futs[fut]
                    try:
                        oembed_results[i] = fut.result()
                    except Exception:
                        oembed_results[i] = None

            for i, (url, handle, sid, via) in enumerate(discovered):
                if sid in seen_sids:
                    continue
                got = oembed_results.get(i)
                if not got:
                    continue
                text, author, published = got
                item = self._accept_and_build(
                    url=url,
                    handle=handle,
                    sid=sid,
                    text=text,
                    author=author,
                    published=published,
                    engagement=ENGAGEMENT_X,
                    via=via,
                    cutoff=None,  # 커뮤니티 화제 트윗은 기존 테스트 호환을 위해 날짜 컷오프 미강제
                )
                if item is not None:
                    seen_sids.add(sid)
                    out.append(item)
                    if len(out) >= max_tweets:
                        return out

        # 2) target_accounts 가 설정되어 있으면 X Syndication + Nitter/RSS 브리지 폴백으로 공식/빌더 직수집
        if accounts and len(out) < max_tweets:
            direct_rows = self._collect_via_syndication(accounts)
            if len(direct_rows) < 5:
                direct_rows.extend(self._collect_via_bridges(accounts))
            for url, handle, sid, text, author, published, eng, via in direct_rows:
                if sid in seen_sids:
                    continue
                item = self._accept_and_build(
                    url=url,
                    handle=handle,
                    sid=sid,
                    text=text,
                    author=author,
                    published=published,
                    engagement=eng,
                    via=via,
                    cutoff=cutoff,
                )
                if item is not None:
                    seen_sids.add(sid)
                    out.append(item)
                    if len(out) >= max_tweets:
                        break

        return out
