"""GitHub 핫 오픈소스 AI & 신규 릴리즈 고유 수집기 (1시간 주기 + 빈손·중복 방어).

20분 스케줄러 내부에서 마지막 GitHub 수집 시각(live-feed-meta.json 의 github_last_collected_at) 기준
60분 경과 시에만 실행된다 (FORCE_GITHUB_COLLECT=1 이면 즉시 실행).

수집 경로 (GitHub 공식 무료 REST API, GITHUB_TOKEN 자동 활용):
  1) 최근 48~72시간 내 생성되어 Star Velocity(시간당 스타 증가율)가 급상승 중인 신규 AI 웹·앱·에이전트 레포
  2) 주요 AI 오픈소스 레포의 최근 72시간 내 신규 정식 릴리즈(releases/latest)

빈손·중복 방어:
  - 이미 수집한 레포(live-feed-meta.json 의 github_seen_repos)는 중복 차단 (신규 릴리즈 태그는 허용)
  - 기준치(스타 수·속도·AI 관련성)를 통과하는 새 정보가 0건이면 저품질 레포로 채우지 않고 빈 목록 반환
"""

from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

from adapters.base import BaseAdapter, SourceSkippedError, parse_dt
from adapters.rss import PRERELEASE_RE, ai_relevant
from collector.classify import classify_news
from collector.models import RawItem

GITHUB_API_BASE = "https://api.github.com"
HOURLY_INTERVAL_MINUTES = 60
TRENDING_WINDOW_HOURS = 72
MIN_STARS_NEW_REPO = 25
MIN_STAR_VELOCITY = 0.55        # 시간당 최소 0.55스타(72h 기준 약 40스타) 또는 총 스타 60+
HIGH_STARS_OVERRIDE = 60
MAX_TRENDING_REPOS = 8
MAX_RELEASES = 6
REQUEST_TIMEOUT = 6.0

# 신규 릴리즈(releases/latest) 추적 대상 주요 AI 오픈소스
TRACKED_RELEASE_REPOS: tuple[str, ...] = (
    "anthropics/claude-code",
    "openai/codex",
    "vercel/ai",
    "browser-use/browser-use",
    "open-webui/open-webui",
    "BerriAI/litellm",
    "cline/cline",
    "n8n-io/n8n",
    "crewAIInc/crewAI",
    "modelcontextprotocol/servers",
)

# 저품질·단순 모음집·크랙/말웨어 스타 스팸 레포 차단
LOW_QUALITY_REPO_RE = re.compile(
    r"(awesome-|curated list|collection of links|interview questions|cheat ?sheet|roadmap|free-courses|"
    r"crack|keygen|hack-tool|activator|serial-key|free-download|full-version|patched|"
    r"-(?:pro-)?(?:win|mac|osx|pc|windows|macos|setup|installer)(?:$|[^a-z0-9])|"
    r"\b(?:capcut|filmora|wondershare|luminar|izotope|photoshop|premiere|adobe\s+pro|descript-pro|copy-ai-pro)\b|"
    r"airdrop|crypto-bot|trading-bot|telegram-bot-spam)",
    re.I,
)
VALID_DEV_LANGUAGES = {
    "python", "typescript", "javascript", "rust", "go", "c++", "c", "c#", "java", "kotlin",
    "swift", "ruby", "php", "dart", "elixir", "scala", "zig", "cuda", "jupyter notebook",
    "html", "vue", "svelte", "shell", "lua",
}
AI_REPO_SIGNAL_RE = re.compile(
    r"\b(ai|llm|agent|agentic|mcp|rag|gpt|claude|gemini|openai|anthropic|deepseek|qwen|llama|ollama|vllm|"
    r"diffusion|flux|voice|tts|whisper|coding|copilot|workflow|automation|inference|embedding|vector|"
    r"multimodal|vision|transformer|fine-?tun|prompt|eval|benchmark|web ?app|cli|sdk)\b",
    re.I,
)


def _github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = (os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def is_quality_ai_repo(repo: dict[str, Any]) -> bool:
    """스팸·크랙/말웨어·포크·단순 링크 모음집을 거르고 실제 코드가 있는 AI 웹·앱·에이전트·도구 레포만 통과."""
    if not isinstance(repo, dict):
        return False
    if repo.get("fork") or repo.get("archived") or repo.get("disabled"):
        return False
    name = str(repo.get("full_name") or "").strip()
    desc = str(repo.get("description") or "").strip()
    topics = " ".join(str(t) for t in (repo.get("topics") or []))
    if not name or len(desc) < 12:
        return False
    hay = f"{name} {desc} {topics}"
    if LOW_QUALITY_REPO_RE.search(hay):
        return False
    # 실제 코드가 없는 말웨어/리드미 전용 스타 팜 차단 (language 필수)
    lang = str(repo.get("language") or "").strip().lower()
    if lang and lang not in VALID_DEV_LANGUAGES:
        return False
    if "language" in repo and not lang:
        return False
    # 비정상 스타-포크 비율(봇 스타 팜: 스타 80+ 인데 포크 0) 차단
    stars = int(repo.get("stargazers_count") or 0)
    if "forks_count" in repo and stars >= 80 and int(repo.get("forks_count") or 0) == 0:
        return False
    return bool(AI_REPO_SIGNAL_RE.search(hay) or ai_relevant(name, desc))


def star_velocity(stars: int, created_at: Optional[datetime], now: datetime) -> float:
    if created_at is None:
        return 0.0
    age_h = max(1.0, (now - created_at).total_seconds() / 3600.0)
    return round(stars / age_h, 2)


class GitHubHotAIAdapter(BaseAdapter):
    endpoint_markers = ("api.github.com/search/repositories",)

    def __init__(self, source, client, guard=None, *, now_fn=None) -> None:
        super().__init__(source, client, guard=guard)
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.skipped: list[str] = []

    def _should_skip_hourly_gate(self, now: datetime) -> Optional[str]:
        if os.getenv("FORCE_GITHUB_COLLECT") == "1":
            return None
        if self.guard is None:
            return None
        last_raw = self.guard.get_extra("github_last_collected_at")
        last_dt = parse_dt(last_raw)
        if last_dt is not None:
            elapsed_min = (now - last_dt).total_seconds() / 60.0
            if 0 <= elapsed_min < HOURLY_INTERVAL_MINUTES:
                remain = max(1, int(HOURLY_INTERVAL_MINUTES - elapsed_min))
                return f"github hourly interval (<60m, next in ~{remain}m)"
        return None

    def _load_seen(self, now: datetime) -> tuple[dict[str, str], dict[str, str]]:
        """이미 수집한 레포와 릴리즈 태그 로드 (30일 지난 기록은 자동 정리)."""
        if self.guard is None:
            return {}, {}
        cutoff = now - timedelta(days=30)
        raw_repos = self.guard.get_extra("github_seen_repos") or {}
        raw_rels = self.guard.get_extra("github_seen_releases") or {}
        seen_repos: dict[str, str] = {}
        seen_rels: dict[str, str] = {}
        if isinstance(raw_repos, dict):
            for k, v in raw_repos.items():
                dt = parse_dt(v)
                if dt is None or dt >= cutoff:
                    seen_repos[str(k).lower()] = str(v)
        if isinstance(raw_rels, dict):
            for k, v in raw_rels.items():
                seen_rels[str(k).lower()] = str(v)
        return seen_repos, seen_rels

    def _save_state(self, now: datetime, seen_repos: dict[str, str], seen_rels: dict[str, str]) -> None:
        if self.guard is None:
            return
        now_iso = now.isoformat().replace("+00:00", "Z")
        self.guard.set_extra("github_last_collected_at", now_iso)
        self.guard.set_extra("github_seen_repos", dict(sorted(seen_repos.items())))
        self.guard.set_extra("github_seen_releases", dict(sorted(seen_rels.items())))

    def _fetch_rising_repos(self, now: datetime, headers: dict[str, str], seen_repos: dict[str, str]) -> list[RawItem]:
        since_date = (now - timedelta(hours=TRENDING_WINDOW_HOURS)).strftime("%Y-%m-%d")
        # GitHub Search API 는 쿼리당 OR 연산자 최대 5개 제한 → 4개 OR 로 안전하게 구성
        query = f"(ai OR llm OR agent OR mcp OR rag) created:>={since_date} stars:>={MIN_STARS_NEW_REPO}"
        url = f"{GITHUB_API_BASE}/search/repositories?{urlencode({'q': query, 'sort': 'stars', 'order': 'desc', 'per_page': 30})}"
        resp = self.client.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        repos = resp.json().get("items") or []

        scored: list[tuple[float, dict[str, Any], datetime]] = []
        window_cutoff = now - timedelta(hours=TRENDING_WINDOW_HOURS)
        for repo in repos:
            if not is_quality_ai_repo(repo):
                continue
            full_name = str(repo.get("full_name") or "").strip()
            if full_name.lower() in seen_repos:
                continue  # 이미 수집한 레포 중복 차단
            created = parse_dt(repo.get("created_at"))
            if created is None or created < window_cutoff:
                continue
            stars = int(repo.get("stargazers_count") or 0)
            vel = star_velocity(stars, created, now)
            if stars < MIN_STARS_NEW_REPO or (vel < MIN_STAR_VELOCITY and stars < HIGH_STARS_OVERRIDE):
                continue
            scored.append((vel, repo, created))

        scored.sort(key=lambda x: (x[0], int(x[1].get("stargazers_count") or 0)), reverse=True)

        now_iso = now.isoformat().replace("+00:00", "Z")
        items: list[RawItem] = []
        for vel, repo, created in scored[:MAX_TRENDING_REPOS]:
            full_name = str(repo["full_name"])
            html_url = str(repo.get("html_url") or f"https://github.com/{full_name}")
            desc = str(repo.get("description") or "").strip()
            stars = int(repo.get("stargazers_count") or 0)
            lang = str(repo.get("language") or "Multi").strip()
            license_spdx = ((repo.get("license") or {}).get("spdx_id") if isinstance(repo.get("license"), dict) else None) or ""
            topics = [str(t) for t in (repo.get("topics") or [])[:5]]
            body_parts = [desc]
            body_parts.append(f"GitHub stars: {stars} (velocity {vel}/h, language: {lang}).")
            if license_spdx and license_spdx != "NOASSERTION":
                body_parts.append(f"License: {license_spdx}.")
            if topics:
                body_parts.append(f"Topics: {', '.join(topics)}.")
            title = f"{full_name}: {desc[:92]}" if desc else full_name
            cat = classify_news(f"{full_name} {desc}", "dev")
            items.append(self.item(
                category=cat,
                url=html_url,
                title=title,
                body=" ".join(body_parts),
                metrics={
                    "feed": "github_trending",
                    "repo": full_name,
                    "stars": stars,
                    "star_velocity": vel,
                    "language": lang,
                    "license": license_spdx,
                },
                engagement=max(80.0, float(stars) * 1.4),
                published_at=created,
            ))
            seen_repos[full_name.lower()] = now_iso
        return items

    def _fetch_latest_releases(self, now: datetime, headers: dict[str, str], seen_rels: dict[str, str]) -> list[RawItem]:
        cutoff = now - timedelta(hours=TRENDING_WINDOW_HOURS)
        items: list[RawItem] = []

        def check_repo(repo_slug: str) -> Optional[tuple[str, str, RawItem]]:
            url = f"{GITHUB_API_BASE}/repos/{repo_slug}/releases/latest"
            resp = self.client.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            rel = resp.json()
            if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
                return None
            tag = str(rel.get("tag_name") or "").strip()
            if not tag or PRERELEASE_RE.search(tag):
                return None
            if seen_rels.get(repo_slug.lower()) == tag:
                return None  # 이미 수집한 릴리즈 태그 중복 차단
            pub = parse_dt(rel.get("published_at")) or parse_dt(rel.get("created_at"))
            if pub is None or pub < cutoff:
                return None
            html_url = str(rel.get("html_url") or f"https://github.com/{repo_slug}/releases/tag/{tag}")
            rel_name = str(rel.get("name") or tag).strip()
            repo_short = repo_slug.split("/", 1)[-1]
            title = rel_name if repo_short.lower() in rel_name.lower() else f"{repo_short} {rel_name}"
            notes = re.sub(r"\s+", " ", str(rel.get("body") or "")).strip()[:2000]
            raw_item = self.item(
                category="dev",
                url=html_url,
                title=title,
                body=notes or f"{repo_slug} {tag} official release published on GitHub.",
                metrics={
                    "feed": "github_release",
                    "repo": repo_slug,
                    "release_tag": tag,
                },
                engagement=110.0,
                published_at=pub,
            )
            return repo_slug.lower(), tag, raw_item

        with ThreadPoolExecutor(max_workers=5) as pool:
            futs = {pool.submit(check_repo, slug): slug for slug in TRACKED_RELEASE_REPOS}
            for fut in as_completed(futs):
                slug = futs[fut]
                try:
                    res = fut.result()
                    if res is not None:
                        key, tag, raw_item = res
                        seen_rels[key] = tag
                        items.append(raw_item)
                except Exception as e:
                    self.skipped.append(f"release {slug}: {type(e).__name__}")

        items.sort(key=lambda x: x.published_at or cutoff, reverse=True)
        return items[:MAX_RELEASES]

    def fetch(self) -> list[RawItem]:
        now = self._now_fn()
        skip_reason = self._should_skip_hourly_gate(now)
        if skip_reason:
            raise SourceSkippedError(skip_reason)

        headers = _github_headers()
        seen_repos, seen_rels = self._load_seen(now)
        items: list[RawItem] = []

        try:
            items.extend(self._fetch_rising_repos(now, headers, seen_repos))
        except Exception as e:
            self.skipped.append(f"trending search: {type(e).__name__}")

        items.extend(self._fetch_latest_releases(now, headers, seen_rels))

        # 빈손이어도 마지막 확인 시각을 기록해 1시간 뒤 다시 확인한다 (억지 저품질 채우기 금지)
        self._save_state(now, seen_repos, seen_rels)
        if not items:
            self.skipped.append("0 qualified hot AI repos/releases this hour (clean skip)")
        return items
