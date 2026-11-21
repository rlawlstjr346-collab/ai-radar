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

LOOKBACK_DAYS = 14
MAX_ENTRIES = 20
PRERELEASE_RE = re.compile(r"(?:^|[-._])(rc|alpha|beta|dev|nightly|pre)\d*", re.I)
GH_RELEASES_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/releases")

# 공식 발표는 '반응 수'가 없으므로 고정 가중치 (HN 포인트 환산)
ENGAGEMENT_OFFICIAL_BLOG = 150.0
ENGAGEMENT_RELEASE = 60.0
ENGAGEMENT_COMMUNITY = 90.0          # 커뮤니티·뉴스레터·사내 기술블로그 (공식 발표보다 약간 낮게)

# AI 키워드 필터를 적용할 종합 피드 (endpoint 부분 문자열)
AI_FILTER_MARKERS: tuple[str, ...] = (
    "news.hada.io", "toss.tech", "techblog.woowahan.com", "medium.com/feed/daangn", "medium.com/feed/musinsa-tech",
    "tech.kakao.com", "d2.naver.com", "engineering.linecorp.com", "b.hatena.ne.jp", "blogs.nvidia.com",
    "arstechnica.com", "36kr.com", "vercel.com/atom",
)
# 커뮤니티·뉴스레터·사내 블로그 (반응 수가 없어 공식 발표보다 낮은 고정 가중치)
COMMUNITY_MARKERS: tuple[str, ...] = AI_FILTER_MARKERS + (
    "discuss.pytorch.kr", "gpters.org", "aikoreacommunity.com", "zenn.dev", "qiita.com", "reddit.com/r/",
    "simonwillison.net", "latent.space", "importai", "sebastianraschka.com", "qbitai.com",
)
AI_KEYWORDS_RE = re.compile(
    r"(\bA\.?I\b|인공지능|LLM|\bGPT|에이전트|\bagents?\b|\bagentic\b|머신러닝|딥러닝|\bML\b|machine learning|"
    r"deep learning|추천|\bvision\b|비전|생성형|\bRAG\b|프롬프트|prompt|임베딩|embedding|Claude|Gemini|OpenAI|"
    r"Anthropic|Llama|Qwen|DeepSeek|Mistral|transformer|트랜스포머|파인튜닝|fine-?tun|inference|추론|\bMCP\b|"
    r"코파일럿|copilot|챗봇|chatbot|生成AI|人工知能|機械学習|大模型|大语言模型|智能体)",
    re.I,
)


def ai_relevant(title: str, body: str = "") -> bool:
    """종합 피드에서 AI·LLM·에이전트·추천·비전 관련 글인지 (제목 우선, 본문 앞부분 보조)."""
    return bool(AI_KEYWORDS_RE.search(title) or AI_KEYWORDS_RE.search(body[:600]))


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
        needs_filter = any(m in self.source.endpoint for m in AI_FILTER_MARKERS)
        community = any(m in self.source.endpoint for m in COMMUNITY_MARKERS)
        cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
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
            if needs_filter and not ai_relevant(title, strip_html(content, 2000)):
                continue                                   # 종합 피드의 비 AI 글은 제외
            if gh:
                tag = link.rstrip("/").rsplit("/", 1)[-1]
                if PRERELEASE_RE.search(tag) or PRERELEASE_RE.search(title):
                    continue                                   # 정식 릴리스만
                repo = gh.group(2)
                if repo.lower() not in title.lower():
                    title = f"{repo} {title}"
                engagement = ENGAGEMENT_RELEASE
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
