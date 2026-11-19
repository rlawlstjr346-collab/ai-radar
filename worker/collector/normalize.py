"""URL 정규화 & dedup_key 생성.

dedup_key 규칙
  arxiv:<id>          arxiv.org/abs|pdf|html, huggingface.co/papers, alphaxiv 등 arXiv ID 가 보이는 모든 URL
  gh:<owner>/<repo>   GitHub 레포 페이지 (tree/blob 하위 포함)
  gh:<owner>/<repo>@<tag>   GitHub 릴리스 (릴리스마다 별도 이슈)
  url:<sha256 24자>   그 외 — 정규화된 canonical_url 해시
"""

from __future__ import annotations

import hashlib
import html
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = {
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "si",
    "ref", "ref_src", "ref_url", "source", "s", "share", "via", "_hsenc", "_hsmi",
}
ARXIV_ID_RE = re.compile(r"(?<!\d)(\d{4}\.\d{4,5})(?:v\d+)?(?!\d)")
ARXIV_HOSTS = ("arxiv.org", "huggingface.co/papers", "alphaxiv.org", "arxiv-sanity", "paperswithcode.com/paper")
GH_RELEASE_RE = re.compile(r"^/([^/]+)/([^/]+)/releases/tag/([^/]+)$")
GH_REPO_RE = re.compile(r"^/([^/]+)/([^/]+)(?:/(?:tree|blob)/.*)?$")
GH_RESERVED = {"orgs", "topics", "collections", "sponsors", "marketplace", "settings", "features", "about"}


def canonicalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return url
    parts = urlsplit(url if "://" in url else f"https://{url}")
    host = parts.hostname.lower() if parts.hostname else ""
    if host.startswith("www."):
        host = host[4:]
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"

    query = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if not k.lower().startswith("utm_") and k.lower() not in TRACKING_PARAMS
    ]
    query.sort()
    path = re.sub(r"/{2,}", "/", parts.path or "/")

    # arXiv 변형(pdf, html, 버전 접미사)은 abs 하나로 통일
    if host == "arxiv.org":
        m = ARXIV_ID_RE.search(path)
        if m:
            return f"https://arxiv.org/abs/{m.group(1)}"

    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunsplit(("https", host, path, urlencode(query), ""))


def extract_arxiv_id(url: str) -> str | None:
    lowered = url.lower()
    if not any(h in lowered for h in ARXIV_HOSTS):
        return None
    m = ARXIV_ID_RE.search(urlsplit(url).path)
    return m.group(1) if m else None


def extract_github(url: str) -> str | None:
    parts = urlsplit(url)
    if (parts.hostname or "").lower().removeprefix("www.") != "github.com":
        return None
    path = parts.path.rstrip("/")
    m = GH_RELEASE_RE.match(path)
    if m:
        return f"gh:{m.group(1).lower()}/{m.group(2).lower()}@{m.group(3)}"
    m = GH_REPO_RE.match(path)
    if m and m.group(1).lower() not in GH_RESERVED:
        repo = m.group(2).lower().removesuffix(".git")
        return f"gh:{m.group(1).lower()}/{repo}"
    return None


def make_dedup_key(url: str) -> str:
    canonical = canonicalize_url(url)
    arxiv_id = extract_arxiv_id(canonical)
    if arxiv_id:
        return f"arxiv:{arxiv_id}"
    gh = extract_github(canonical)
    if gh:
        return gh
    return "url:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def strip_html(text: str, limit: int | None = None) -> str:
    """피드/설명문 HTML 을 요약기 입력용 평문으로. (렌더링 목적 아님)"""
    if not text:
        return ""
    text = re.sub(r"<(br|/p|/li|/h\d)\s*/?>", "\n", text, flags=re.I)
    text = html.unescape(_TAG_RE.sub("", text))
    text = "\n".join(_WS_RE.sub(" ", ln).strip() for ln in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:limit] if limit else text
