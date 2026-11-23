"""범용 RSS/Atom 어댑터 — 공식 블로그(OpenAI, DeepMind) + GitHub Releases Atom + 국내·일본·중국 다국어 피드.

종합 기술블로그·커뮤니티(토스·우아한형제들·당근·무신사·카카오·네이버 D2·LINE, 긱뉴스, 하테나 등)는
AI 관련 글만 남긴다 (AI_FILTER_MARKERS 에 걸리는 endpoint → ai_relevant() 통과 글만).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

import feedparser

from adapters.base import BaseAdapter, parse_dt
from collector.classify import classify_news
from collector.models import RawItem
from collector.normalize import strip_html
from pipeline.curator import is_blocked_noise

LOOKBACK_DAYS = 14
SUBSTACK_LOOKBACK_DAYS = 30
MAX_ENTRIES = 20
PRERELEASE_RE = re.compile(r"(?:^|[-._])(rc|alpha|beta|dev|nightly|pre)\d*", re.I)
GH_RELEASES_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/releases")

# 공식 발표는 '반응 수'가 없으므로 고정 가중치 (HN 포인트 환산)
ENGAGEMENT_OFFICIAL_BLOG = 160.0
ENGAGEMENT_SUBSTACK = 120.0          # 핵심 AI Substack 뉴스레터
ENGAGEMENT_RELEASE = 60.0
ENGAGEMENT_COMMUNITY = 90.0          # 커뮤니티·사내 기술블로그

SUBSTACK_MARKERS: tuple[str, ...] = (
    "latent.space",
    "importai.substack.com",
    "sebastianraschka.com",
    "oneusefulthing.org",
    "interconnects.ai",
)

# AI 키워드 필터를 적용할 종합 피드 (endpoint 부분 문자열)
AI_FILTER_MARKERS: tuple[str, ...] = (
    "news.hada.io", "toss.tech", "techblog.woowahan.com", "medium.com/feed/daangn", "medium.com/feed/musinsa-tech",
    "tech.kakao.com", "d2.naver.com", "engineering.linecorp.com", "b.hatena.ne.jp", "blogs.nvidia.com",
    "arstechnica.com", "36kr.com", "vercel.com/atom",
)
# 커뮤니티·뉴스레터·사내 블로그 (반응 수가 없어 공식 발표보다 낮은 고정 가중치)
COMMUNITY_MARKERS: tuple[str, ...] = AI_FILTER_MARKERS + (
    "discuss.pytorch.kr", "gpters.org", "aikoreacommunity.com", "zenn.dev", "qiita.com", "reddit.com/r/",
    "simonwillison.net", "qbitai.com",
) + SUBSTACK_MARKERS
AI_KEYWORDS_RE = re.compile(
    r"(\bA\.?I\b|인공지능|LLM|\bGPT|에이전트|\bagents?\b|\bagentic\b|머신러닝|딥러닝|\bML\b|machine learning|"
    r"deep learning|추천|\bvision\b|비전|생성형|\bRAG\b|프롬프트|prompt|임베딩|embedding|Claude|Gemini|OpenAI|"
    r"Anthropic|Llama|Qwen|DeepSeek|Mistral|transformer|트랜스포머|파인튜닝|fine-?tun|inference|추론|\bMCP\b|"
    r"코파일럿|copilot|챗봇|chatbot|生成AI|人工知能|機械学習|大模型|大语言模型|智能体)",
    re.I,
)


# Apple Newsroom 공식 피드: 매장 오픈·엔터테인먼트·일반 홍보 100% 차단, 명확한 AI·ML 글만 통과
APPLE_NEWSROOM_MARKERS: tuple[str, ...] = (
    "apple.com/newsroom/rss-feed.rss",
    "apple.com/kr/newsroom/rss-feed.rss",
)
APPLE_AI_STRICT_RE = re.compile(
    r"(Apple\s+Intelligence|애플\s*인텔리전스|\bMLX\b|Core\s*ML|Neural\s+Engine|뉴럴\s*엔진|"
    r"Foundation\s+Models?|\bSiri\b|\bLLM\b|machine\s+learning|머신러닝|인공지능|온디바이스\s*AI|"
    r"Private\s+Cloud\s+Compute|OpenELM|Ferret|FastVLM|\bAI\s+(?:model|feature|research|chip|agent|기능|모델|연구))",
    re.I,
)


def ai_relevant(title: str, body: str = "") -> bool:
    """종합 피드에서 AI·LLM·에이전트·추천·비전 관련 글인지 (제목 우선, 본문 앞부분 보조)."""
    return bool(AI_KEYWORDS_RE.search(title) or AI_KEYWORDS_RE.search(body[:600]))


def is_apple_ai_news(title: str, body: str = "") -> bool:
    """Apple Newsroom 피드 전용 엄격 AI 필터 (일반 제품·매장·엔터 홍보 100% 스킵)."""
    return bool(APPLE_AI_STRICT_RE.search(title) or APPLE_AI_STRICT_RE.search(body[:800]))


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
        is_apple_newsroom = any(m in self.source.endpoint for m in APPLE_NEWSROOM_MARKERS)
        is_substack = any(m in self.source.endpoint for m in SUBSTACK_MARKERS)
        needs_filter = any(m in self.source.endpoint for m in AI_FILTER_MARKERS)
        community = any(m in self.source.endpoint for m in COMMUNITY_MARKERS)
        lookback = SUBSTACK_LOOKBACK_DAYS if is_substack else LOOKBACK_DAYS
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback)
        entries = []
        for e in feed.entries:
            published = (
                parse_dt(e.get("published_parsed"))
                or parse_dt(e.get("published"))
                or parse_dt(e.get("updated_parsed"))
                or parse_dt(e.get("updated"))
                or parse_dt(e.get("created_parsed"))
                or parse_dt(e.get("created"))
            )
            if published and published < cutoff:
                continue
            entries.append((published, e))
        entries.sort(key=lambda x: x[0] or cutoff, reverse=True)

        out = []
        for published, e in entries[:MAX_ENTRIES]:
            link, title = e.get("link"), (e.get("title") or "").strip()
            if link and not link.startswith(("http://", "https://")):
                link = urljoin(feed.feed.get("link") or self.source.endpoint, link)   # 상대 경로 링크 보정
            if not link or not title:
                continue
            content = (e.get("content") or [{}])[0].get("value") or e.get("summary") or ""
            plain_preview = strip_html(content, 2000)
            if is_blocked_noise(title, plain_preview, link):
                continue                                   # 독서 모임·채용·모객 홍보글 차단
            if is_apple_newsroom and not is_apple_ai_news(title, plain_preview):
                continue                                   # Apple Newsroom 비-AI 일반/매장/엔터 글 100% 스킵
            if needs_filter and not ai_relevant(title, plain_preview):
                continue                                   # 종합 피드의 비 AI 글은 제외
            if gh:
                tag = link.rstrip("/").rsplit("/", 1)[-1]
                if PRERELEASE_RE.search(tag) or PRERELEASE_RE.search(title):
                    continue                                   # 정식 릴리스만
                repo = gh.group(2)
                if repo.lower() not in title.lower():
                    title = f"{repo} {title}"
                engagement = ENGAGEMENT_RELEASE
            elif is_substack:
                engagement = ENGAGEMENT_SUBSTACK
            else:
                engagement = ENGAGEMENT_COMMUNITY if community else ENGAGEMENT_OFFICIAL_BLOG
            out.append(self.item(
                # 릴리스 노트는 소스 기본값 그대로, 공식 블로그는 제목으로 업계/연구 보정
                category=self.source.default_category if gh else classify_news(title, self.source.default_category),
                url=link,
                title=title,
                body=strip_html(content, 20000),     # 릴리스 노트·블로그 본문은 길게 (items.raw_body 대체 원문용)
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
