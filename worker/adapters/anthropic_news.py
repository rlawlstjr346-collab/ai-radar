"""Anthropic News 전용 컬렉터 (`anthropic_news`).

Anthropic 은 공식 RSS 를 제공하지 않으므로:
1. 공식 뉴스룸 페이지(`https://www.anthropic.com/news`) HTML 의 JSON-LD 및 아티클/리스트 카드에서
   실제 제목·링크·요약 본문·발행일을 안정적으로 추출하고
2. 날짜가 생략된 카드 보완 및 최신 `/research/` 글 확보를 위해 `https://www.anthropic.com/sitemap.xml` 을
   보조 폴백으로 결합한다.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from xml.etree import ElementTree as ET

from adapters.anthropic_sitemap import NS as SITEMAP_NS
from adapters.anthropic_sitemap import PATH_RE as SITEMAP_PATH_RE
from adapters.anthropic_sitemap import title_from_slug
from adapters.base import BaseAdapter, parse_dt
from collector.classify import classify_news
from collector.models import RawItem
from collector.normalize import strip_html

LOOKBACK_DAYS = 30
MAX_ENTRIES = 16
ENGAGEMENT_OFFICIAL = 180.0
SITEMAP_URL = "https://www.anthropic.com/sitemap.xml"

CATEGORY_SLUGS = {
    "announcements",
    "features",
    "policy",
    "product",
    "company",
    "research",
    "engineering",
    "alignment",
    "interpretability",
    "societal-impacts",
}

JSONLD_RE = re.compile(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
LISTING_ROW_RE = re.compile(r'<li[^>]*data-listing-row="[^"]*"[^>]*>(.*?)</li>', re.S | re.I)
NEWS_HREF_RE = re.compile(r'href=["\'](/news/([a-z0-9][a-z0-9-]*))["\']', re.I)
HEADING_RE = re.compile(r"<h[1-4][^>]*>(.*?)</h[1-4]>", re.S | re.I)
PARA_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
TIME_RE = re.compile(r"<time[^>]*?(?:datetime=[\"']([^\"']+)[\"'])?[^>]*>(.*?)</time>", re.S | re.I)
IMG_ALT_RE = re.compile(r'alt=["\']([^"\']{8,200})["\']', re.I)
MONTH_DATE_RE = re.compile(
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b",
    re.I,
)
MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_human_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    dt = parse_dt(raw)
    if dt is not None:
        return dt
    m = MONTH_DATE_RE.search(raw)
    if m:
        month = MONTH_MAP.get(m.group(1)[:3].lower())
        if month:
            try:
                return datetime(int(m.group(3)), month, int(m.group(2)), tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def _clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(strip_html(raw or "", 4000))).strip()


def _parse_jsonld(html_text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for block in JSONLD_RE.findall(html_text):
        try:
            parsed = json.loads(block.strip())
        except Exception:
            continue
        stack = parsed if isinstance(parsed, list) else [parsed]
        while stack:
            node = stack.pop(0)
            if not isinstance(node, dict):
                continue
            if "@graph" in node and isinstance(node["@graph"], list):
                stack.extend(node["@graph"])
            if "itemListElement" in node and isinstance(node["itemListElement"], list):
                for el in node["itemListElement"]:
                    if isinstance(el, dict):
                        stack.append(el.get("item") if isinstance(el.get("item"), dict) else el)
            url = str(node.get("url") or node.get("@id") or "").strip()
            title = str(node.get("headline") or node.get("name") or "").strip()
            if "/news/" in url and title:
                if url.startswith("/"):
                    url = f"https://www.anthropic.com{url}"
                slug = url.rstrip("/").rsplit("/", 1)[-1]
                if slug and slug not in CATEGORY_SLUGS:
                    records.append({
                        "url": url,
                        "slug": slug,
                        "title": _clean_text(title),
                        "body": _clean_text(str(node.get("description") or node.get("articleBody") or "")),
                        "published_at": _parse_human_date(str(node.get("datePublished") or node.get("dateModified") or "")),
                    })
    return records


def extract_anthropic_news_from_html(html_text: str) -> list[dict[str, Any]]:
    """Anthropic /news HTML(JSON-LD + 리스트 행 + 피처드 카드)에서 최신 기사 목록 추출."""
    by_slug: dict[str, dict[str, Any]] = {}

    # 1) JSON-LD 구조화 데이터 우선 수집
    for rec in _parse_jsonld(html_text):
        by_slug[rec["slug"]] = rec

    # 2) 최신 뉴스 리스트 행(<li data-listing-row="...">) 파싱
    for row_html in LISTING_ROW_RE.findall(html_text):
        m_href = NEWS_HREF_RE.search(row_html)
        if not m_href:
            continue
        path, slug = m_href.group(1), m_href.group(2).lower()
        if slug in CATEGORY_SLUGS:
            continue
        headings = [_clean_text(h) for h in HEADING_RE.findall(row_html)]
        title = next((h for h in headings if len(h) >= 6), "") or title_from_slug(slug)
        paras = [_clean_text(p) for p in PARA_RE.findall(row_html)]
        body = next((p for p in paras if len(p) >= 24 and p.lower() not in CATEGORY_SLUGS), "")
        pub: Optional[datetime] = None
        for dt_attr, dt_inner in TIME_RE.findall(row_html):
            pub = _parse_human_date(dt_attr or _clean_text(dt_inner))
            if pub:
                break
        if pub is None:
            pub = _parse_human_date(row_html)

        prev = by_slug.get(slug)
        by_slug[slug] = {
            "url": f"https://www.anthropic.com{path}",
            "slug": slug,
            "title": title if len(title) >= len((prev or {}).get("title") or "") else prev["title"],
            "body": body or (prev or {}).get("body") or "",
            "published_at": pub or (prev or {}).get("published_at"),
        }

    # 3) 상단 히어로·피처드 카드 블록 스캔
    for m in NEWS_HREF_RE.finditer(html_text):
        path, slug = m.group(1), m.group(2).lower()
        if slug in CATEGORY_SLUGS:
            continue
        window = html_text[max(0, m.start() - 420): min(len(html_text), m.end() + 620)]
        headings = [_clean_text(h) for h in HEADING_RE.findall(window)]
        title = next((h for h in headings if len(h) >= 8), "")
        if not title:
            m_alt = IMG_ALT_RE.search(window)
            if m_alt:
                title = _clean_text(m_alt.group(1))
        paras = [_clean_text(p) for p in PARA_RE.findall(window)]
        body = next((p for p in paras if len(p) >= 28 and p.lower() not in CATEGORY_SLUGS), "")
        pub = None
        for dt_attr, dt_inner in TIME_RE.findall(window):
            pub = _parse_human_date(dt_attr or _clean_text(dt_inner))
            if pub:
                break

        prev = by_slug.get(slug)
        if prev is None:
            by_slug[slug] = {
                "url": f"https://www.anthropic.com{path}",
                "slug": slug,
                "title": title or title_from_slug(slug),
                "body": body,
                "published_at": pub,
            }
        else:
            if not prev.get("published_at") and pub:
                prev["published_at"] = pub
            if len(body) > len(prev.get("body") or ""):
                prev["body"] = body
            if title and len(title) > len(prev.get("title") or "") and prev["title"] == title_from_slug(slug):
                prev["title"] = title

    return list(by_slug.values())


class AnthropicNewsAdapter(BaseAdapter):
    endpoint_markers = ("anthropic.com/news",)

    def _fetch_sitemap_dates(self) -> tuple[dict[str, datetime], list[tuple[datetime, str, str, str]]]:
        """sitemap.xml 에서 /news/ 발행 시각 보강 및 최신 /research/ 목록 추출 (실패해도 무시)."""
        try:
            resp = self.get(SITEMAP_URL, conditional=False)
            root = ET.fromstring(resp.content)
        except Exception:
            return {}, []

        dates_by_url: dict[str, datetime] = {}
        research_rows: list[tuple[datetime, str, str, str]] = []
        for url_el in root.findall("sm:url", SITEMAP_NS):
            loc = (url_el.findtext("sm:loc", default="", namespaces=SITEMAP_NS) or "").strip()
            m = SITEMAP_PATH_RE.match(loc)
            if not m:
                continue
            lastmod = parse_dt(url_el.findtext("sm:lastmod", default="", namespaces=SITEMAP_NS))
            if not lastmod:
                continue
            dates_by_url[loc] = lastmod
            if m.group(1) == "research":
                research_rows.append((lastmod, m.group(1), m.group(2), loc))
        research_rows.sort(reverse=True)
        return dates_by_url, research_rows

    def fetch(self) -> list[RawItem]:
        html_text = self.get(self.source.endpoint).text
        records = extract_anthropic_news_from_html(html_text)
        sitemap_dates, research_rows = self._fetch_sitemap_dates()

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=LOOKBACK_DAYS)
        items: list[RawItem] = []
        seen_urls: set[str] = set()

        for rec in records:
            url = rec["url"]
            if url in seen_urls:
                continue
            pub = rec.get("published_at") or sitemap_dates.get(url)
            if pub and pub < cutoff:
                continue
            seen_urls.add(url)
            title = rec["title"] or title_from_slug(rec["slug"])
            body = rec.get("body") or f"Anthropic 공식 뉴스룸 발표: {title}."
            items.append(self.item(
                category=classify_news(title, self.source.default_category),
                url=url,
                title=title,
                body=body,
                metrics={"feed": "anthropic_news", "section": "news"},
                engagement=ENGAGEMENT_OFFICIAL,
                published_at=pub,
            ))

        # 최신 /research/ 발표도 상위 4건 보강
        for lastmod, section, slug, loc in research_rows[:6]:
            if lastmod < cutoff or loc in seen_urls:
                continue
            seen_urls.add(loc)
            pretty = title_from_slug(slug)
            items.append(self.item(
                category="research",
                url=loc,
                title=f"Anthropic Research: {pretty}",
                body=f"Anthropic 공식 연구 보고서 '{pretty}' ({loc})가 공개됐습니다.",
                metrics={"feed": "anthropic_news", "section": section, "lastmod": lastmod.isoformat()},
                engagement=ENGAGEMENT_OFFICIAL,
                published_at=lastmod,
            ))

        items.sort(key=lambda x: x.published_at or cutoff, reverse=True)
        return items[:MAX_ENTRIES]
