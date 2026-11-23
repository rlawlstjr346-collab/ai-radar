"""외국어 기사 0원 자동 한국어 번역기 + URL 기준 영구 캐시.

우선순위:
1. ANTHROPIC_API_KEY가 있으면 Claude로 자연스러운 한국어 번역·요약
2. GEMINI_API_KEY가 있으면 Gemini API로 자연스러운 한국어 번역·요약
3. API 키가 없는 0원 환경(GitHub Actions 기본)에서는 deep-translator(GoogleTranslator, source='auto', target='ko')로 자동 번역

안전 원칙:
- 한글 비율이 20% 미만인 외국어(영어·일본어·중국어 등) 제목/본문만 선별 번역
- 기존 live-feed.json / live-feed-meta.json 의 URL 기준 캐시를 재사용해 매시간 중복 번역 방지
- 번역 실패·네트워크 장애·429 시에도 예외로 파이프라인을 멈추지 않고 안전 폴백
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

log = logging.getLogger("ai_radar.translator")

HANGUL_THRESHOLD = 0.20
CACHE_TTL_DAYS = 35
MAX_TRANSLATE_BODY_CHARS = 900
GOOGLE_CHUNK_LIMIT = 4000
MYMEMORY_CHUNK_LIMIT = 430
MAX_CONSECUTIVE_ERRORS = 5

HANGUL_RE = re.compile(r"[가-힣]")
JP_KANA_RE = re.compile(r"[\u3040-\u30ff]")
CJK_HAN_RE = re.compile(r"[\u4e00-\u9fff]")
LANG_CHAR_RE = re.compile(r"[가-힣A-Za-z\u3040-\u30ff\u4e00-\u9fff]")
URL_RE = re.compile(r"https?://\S+")
AT_PREFIX_RE = re.compile(r"^(@[A-Za-z0-9_.-]{1,32}:\s*)(.+)$", re.S)
RELEASE_TITLE_RE = re.compile(r"^[A-Za-z0-9._/-]+(?:\s+Release)?\s+v?\d+(?:\.\d+)+(?:[-.\w]*)?$", re.I)
REPO_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

# 어댑터가 생성한 영문 상투 문구(번역 전에 정리해 어색한 직역을 방지)
BOILERPLATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^Official Anthropic (?:news|research) page at https?://\S+\.\s*", re.I),
    re.compile(r"^Only the URL title is available \(no article text was collected\)\.\s*", re.I),
    re.compile(
        r"^Hacker News story with \d+ points and \d+ comments\.\s*Discussion:\s*https?://\S+\.?\s*",
        re.I,
    ),
    re.compile(r"^Bluesky post by @[^\s:]+:\s*", re.I),
)


def hangul_ratio(text: str) -> float:
    """텍스트의 언어 문자(한글·영문·일본어·한자) 대비 한글 비율(0.0~1.0). 언어 문자가 없으면 1.0."""
    if not text:
        return 1.0
    cleaned = URL_RE.sub("", text)
    lang_chars = LANG_CHAR_RE.findall(cleaned)
    if not lang_chars:
        return 1.0
    hangul_chars = HANGUL_RE.findall(cleaned)
    return len(hangul_chars) / len(lang_chars)


def needs_translation(text: str, threshold: float = HANGUL_THRESHOLD) -> bool:
    """한글 비율이 threshold(기본 20%) 미만인 외국어 텍스트인지 판별."""
    if not text or not text.strip():
        return False
    cleaned = URL_RE.sub("", text).strip()
    if len(LANG_CHAR_RE.findall(cleaned)) < 4:
        return False
    return hangul_ratio(cleaned) < threshold


def needs_article_translation(
    title: str,
    raw_summary: str = "",
    summary_lines: Optional[list[str]] = None,
    threshold: float = HANGUL_THRESHOLD,
) -> bool:
    """기사 제목·본문·요약 줄 중 하나라도 한글 비율이 20% 미만이면 번역 대상."""
    if needs_translation(title, threshold):
        return True
    if raw_summary and needs_translation(raw_summary, threshold):
        return True
    for line in summary_lines or []:
        if line and needs_translation(line, threshold):
            return True
    return False


def clean_source_boilerplate(body: str) -> str:
    """어댑터가 덧붙인 영문 메타 문구와 날 URL 을 정리해 번역 품질을 높인다."""
    if not body:
        return ""
    txt = re.sub(r"\s+", " ", body).strip()
    for pat in BOILERPLATE_PATTERNS:
        txt = pat.sub("", txt).strip()
    txt = URL_RE.sub("", txt)
    txt = re.sub(r"\(\s*\)", "", txt)
    txt = re.sub(r"\s+", " ", txt).strip(" -—|·")
    return txt


@dataclass
class TranslatedArticle:
    original_title: str
    title_ko: str
    body_ko: str
    translated: bool
    provider: str
    why_ko: Optional[str] = None
    caveats_ko: Optional[str] = None


class TranslationCache:
    """live-feed-meta.json 의 `translations` 섹션 + 기존 live-feed.json 을 URL 기준으로 재사용하는 캐시."""

    def __init__(self, meta_path: Optional[Path] = None, *, now: Optional[datetime] = None) -> None:
        self.meta_path = Path(meta_path) if meta_path is not None else None
        self.now = now or datetime.now(timezone.utc)
        self.entries: dict[str, dict[str, Any]] = {}
        self._dirty = False
        if self.meta_path and self.meta_path.exists():
            self._load()

    def _load(self) -> None:
        assert self.meta_path is not None
        try:
            raw = json.loads(self.meta_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("translations"), dict):
                self.entries = {
                    str(k): dict(v) for k, v in raw["translations"].items() if isinstance(v, dict)
                }
        except Exception:
            self.entries = {}

    def seed_from_snapshot_items(self, items: list[dict[str, Any]]) -> None:
        """기존 live-feed.json 에 이미 한국어로 번역·저장된 기사를 메모리 캐시에 적재."""
        for it in items:
            if not isinstance(it, dict):
                continue
            url = str(it.get("canonical_url") or "").strip()
            if not url or url in self.entries:
                continue
            title_ko = str(it.get("title_ko") or it.get("hook_title") or "").strip()
            original_title = str(it.get("original_title") or title_ko).strip()
            what_ko = str(it.get("what_ko") or "").strip()
            if not title_ko or needs_translation(title_ko) or needs_translation(what_ko):
                continue
            # 이미 한국어 번역 완료된 항목만 캐시에 시드 (미번역 외국어 항목은 재번역 대상)
            if it.get("title_ko") or (original_title != title_ko):
                self.entries[url] = {
                    "original_title": original_title,
                    "title_ko": title_ko,
                    "body_ko": str(it.get("_body_ko") or ""),
                    "provider": str(it.get("translation_provider") or "snapshot_cache"),
                    "cached_at": str(it.get("fetched_at") or it.get("created_at") or self.now.isoformat().replace("+00:00", "Z")),
                }

    def get(self, url: str) -> Optional[dict[str, Any]]:
        entry = self.entries.get(url)
        if not entry:
            return None
        title_ko = str(entry.get("title_ko") or "").strip()
        if not title_ko or needs_translation(title_ko):
            return None
        return entry

    def put(
        self,
        url: str,
        *,
        original_title: str,
        title_ko: str,
        body_ko: str,
        provider: str,
        why_ko: Optional[str] = None,
        caveats_ko: Optional[str] = None,
    ) -> None:
        if not url or not title_ko:
            return
        record: dict[str, Any] = {
            "original_title": original_title,
            "title_ko": title_ko,
            "body_ko": body_ko,
            "provider": provider,
            "cached_at": self.now.isoformat().replace("+00:00", "Z"),
        }
        if why_ko:
            record["why_ko"] = why_ko
        if caveats_ko:
            record["caveats_ko"] = caveats_ko
        self.entries[url] = record
        self._dirty = True

    def prune(self, now: Optional[datetime] = None) -> None:
        now = now or self.now
        cutoff = now - timedelta(days=CACHE_TTL_DAYS)
        kept: dict[str, dict[str, Any]] = {}
        for url, entry in self.entries.items():
            raw_dt = entry.get("cached_at")
            keep = True
            if isinstance(raw_dt, str) and raw_dt:
                try:
                    dt = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt < cutoff:
                        keep = False
                except ValueError:
                    pass
            if keep:
                kept[url] = entry
        if len(kept) != len(self.entries):
            self.entries = kept
            self._dirty = True

    def save(self) -> None:
        if not self.meta_path or not self._dirty:
            return
        self.prune()
        self.meta_path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {}
        if self.meta_path.exists():
            try:
                disk = json.loads(self.meta_path.read_text(encoding="utf-8"))
                if isinstance(disk, dict):
                    payload = disk
            except Exception:
                payload = {}
        payload["translations"] = dict(sorted(self.entries.items()))
        self.meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._dirty = False


def _split_chunks(text: str, limit: int = GOOGLE_CHUNK_LIMIT) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    rest = text
    while rest:
        if len(rest) <= limit:
            chunks.append(rest)
            break
        cut = rest.rfind(". ", 0, limit)
        if cut < limit // 2:
            cut = rest.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        else:
            cut += 1
        chunks.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    return [c for c in chunks if c]


def _extract_json_object(raw: str) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(s[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except ValueError:
        return None


class ArticleTranslator:
    """외국어 기사 자동 한국어 번역기 (Anthropic → Gemini → deep-translator 0원 폴백)."""

    def __init__(
        self,
        *,
        cache: Optional[TranslationCache] = None,
        anthropic_api_key: Optional[str] = None,
        gemini_api_key: Optional[str] = None,
        translate_text_fn: Optional[Callable[[str], str]] = None,
        delay_sec: float = 0.28,
        enabled: bool = True,
    ) -> None:
        self.cache = cache
        self.anthropic_api_key = (
            anthropic_api_key if anthropic_api_key is not None else (os.getenv("ANTHROPIC_API_KEY") or "").strip()
        )
        self.gemini_api_key = (
            gemini_api_key if gemini_api_key is not None else (os.getenv("GEMINI_API_KEY") or "").strip()
        )
        self._translate_text_fn = translate_text_fn
        self._delay_sec = delay_sec
        self.enabled = enabled
        self._consecutive_errors = 0
        self._google_blocked = False
        self._google_translator: Any = None
        self._mymemory_translators: dict[str, Any] = {}
        self.stats: dict[str, int] = {"cache_hits": 0, "translated": 0, "skipped_ko": 0, "fallbacks": 0}

    def _get_google_translator(self) -> Any:
        if self._google_translator is None:
            from deep_translator import GoogleTranslator

            self._google_translator = GoogleTranslator(source="auto", target="ko")
        return self._google_translator

    @staticmethod
    def _detect_mymemory_source(text: str) -> str:
        if JP_KANA_RE.search(text):
            return "ja-JP"
        if CJK_HAN_RE.search(text) and not HANGUL_RE.search(text):
            return "zh-CN"
        return "en-US"

    def _get_mymemory_translator(self, src_lang: str) -> Any:
        tr = self._mymemory_translators.get(src_lang)
        if tr is None:
            from deep_translator import MyMemoryTranslator

            tr = MyMemoryTranslator(source=src_lang, target="ko-KR")
            self._mymemory_translators[src_lang] = tr
        return tr

    def _translate_mymemory(self, text: str) -> Optional[str]:
        if not text or not text.strip():
            return ""
        if self._consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            return None
        try:
            src_lang = self._detect_mymemory_source(text)
            tr = self._get_mymemory_translator(src_lang)
            out_parts: list[str] = []
            for chunk in _split_chunks(text, MYMEMORY_CHUNK_LIMIT):
                if self._delay_sec > 0:
                    time.sleep(min(self._delay_sec, 0.25))
                res = tr.translate(chunk)
                if res:
                    s = str(res).strip()
                    if "MYMEMORY WARNING" in s.upper():
                        raise RuntimeError(s)
                    out_parts.append(s)
            joined = " ".join(out_parts).strip()
            if joined:
                self._consecutive_errors = 0
                return joined
            return None
        except Exception as exc:
            self._consecutive_errors += 1
            log.warning("MyMemoryTranslator failed (%d/%d): %s", self._consecutive_errors, MAX_CONSECUTIVE_ERRORS, exc)
            return None

    def _translate_google_gtx(self, text: str) -> Optional[str]:
        """무료 공개 Google Translate GTX JSON 엔드포인트 (deep-translator 보다 안정적이고 429 내성이 높음)."""
        if not text or not text.strip():
            return ""
        try:
            out_parts: list[str] = []
            for chunk in _split_chunks(text, 1800):
                if self._delay_sec > 0:
                    time.sleep(min(self._delay_sec, 0.22))
                resp = httpx.get(
                    "https://translate.googleapis.com/translate_a/single",
                    params={
                        "client": "gtx",
                        "sl": "auto",
                        "tl": "ko",
                        "dt": "t",
                        "q": chunk,
                    },
                    headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"},
                    timeout=10.0,
                )
                if resp.status_code == 429:
                    self._google_blocked = True
                    return None
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, list) and data and isinstance(data[0], list):
                    seg_txt = "".join(str(seg[0]) for seg in data[0] if isinstance(seg, list) and seg and seg[0])
                    if seg_txt.strip():
                        out_parts.append(seg_txt.strip())
            joined = " ".join(out_parts).strip()
            if joined:
                self._consecutive_errors = 0
                return joined
            return None
        except Exception as exc:
            log.warning("Google GTX translation failed, trying fallback: %s", exc)
            return None

    def _translate_google(self, text: str) -> Optional[str]:
        if not text or not text.strip():
            return ""
        if self._google_blocked:
            return self._translate_mymemory(text)
        if self._consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            return None
        gtx = self._translate_google_gtx(text)
        if gtx:
            return gtx
        try:
            tr = self._get_google_translator()
            out_parts: list[str] = []
            for chunk in _split_chunks(text, GOOGLE_CHUNK_LIMIT):
                if self._delay_sec > 0:
                    time.sleep(self._delay_sec)
                res = tr.translate(chunk)
                if res:
                    out_parts.append(str(res).strip())
            joined = " ".join(out_parts).strip()
            if joined:
                self._consecutive_errors = 0
                return joined
            return None
        except Exception as exc:
            msg = str(exc).lower()
            if "too many requests" in msg or "429" in msg:
                self._google_blocked = True
                log.warning("GoogleTranslator rate-limited (429), switching to MyMemoryTranslator fallback")
                return self._translate_mymemory(text)
            self._consecutive_errors += 1
            log.warning("GoogleTranslator failed (%d/%d): %s", self._consecutive_errors, MAX_CONSECUTIVE_ERRORS, exc)
            return self._translate_mymemory(text)

    def _translate_with_anthropic(self, title: str, body: str) -> Optional[dict[str, str]]:
        if not self.anthropic_api_key:
            return None
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=self.anthropic_api_key, timeout=20.0)
            model = os.getenv("TRANSLATOR_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
            prompt = (
                "다음 외국어 AI 뉴스 제목과 본문 발췌를 입문자가 읽기 쉬운 자연스러운 한국어로 번역·정리해 주세요.\n"
                "고유명사(OpenAI, Claude, Gemini, vLLM 등)는 유지하고, 과장 표현(혁신적, 획기적, 충격 등)은 쓰지 마세요.\n"
                '반드시 JSON 객체만 출력하세요: {"title_ko": "...", "body_ko": "...", "why_ko": "..."}\n\n'
                f"제목: {title}\n"
                f"본문: {body[:MAX_TRANSLATE_BODY_CHARS]}"
            )
            resp = client.messages.create(
                model=model,
                max_tokens=700,
                messages=[{"role": "user", "content": prompt}],
            )
            text_chunks = [getattr(b, "text", "") for b in (resp.content or []) if getattr(b, "type", "") == "text"]
            parsed = _extract_json_object("\n".join(text_chunks))
            if parsed and parsed.get("title_ko"):
                return {
                    "title_ko": str(parsed["title_ko"]).strip(),
                    "body_ko": str(parsed.get("body_ko") or "").strip(),
                    "why_ko": str(parsed.get("why_ko") or "").strip(),
                }
        except Exception as exc:
            log.warning("Anthropic translation failed, falling back: %s", exc)
        return None

    def _translate_with_gemini(self, title: str, body: str) -> Optional[dict[str, str]]:
        if not self.gemini_api_key:
            return None
        try:
            model = os.getenv("TRANSLATOR_GEMINI_MODEL", "gemini-2.5-flash")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            prompt = (
                "다음 외국어 AI 뉴스 제목과 본문 발췌를 입문자가 읽기 쉬운 자연스러운 한국어로 번역·정리해 주세요.\n"
                "고유명사(OpenAI, Claude, Gemini, vLLM 등)는 유지하고, 과장 표현(혁신적, 획기적, 충격 등)은 쓰지 마세요.\n"
                '반드시 JSON 객체만 출력하세요: {"title_ko": "...", "body_ko": "...", "why_ko": "..."}\n\n'
                f"제목: {title}\n"
                f"본문: {body[:MAX_TRANSLATE_BODY_CHARS]}"
            )
            resp = httpx.post(
                url,
                params={"key": self.gemini_api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
                },
                timeout=20.0,
            )
            resp.raise_for_status()
            data = resp.json()
            cands = data.get("candidates") or []
            parts = ((cands[0].get("content") or {}).get("parts") or []) if cands else []
            raw_text = "".join(str(p.get("text") or "") for p in parts)
            parsed = _extract_json_object(raw_text)
            if parsed and parsed.get("title_ko"):
                return {
                    "title_ko": str(parsed["title_ko"]).strip(),
                    "body_ko": str(parsed.get("body_ko") or "").strip(),
                    "why_ko": str(parsed.get("why_ko") or "").strip(),
                }
        except Exception as exc:
            log.warning("Gemini translation failed, falling back: %s", exc)
        return None

    def translate_text(self, text: str) -> Optional[str]:
        """단일 외국어 텍스트를 한국어로 번역 (실패 시 None)."""
        if not text or not text.strip():
            return ""
        if not needs_translation(text):
            return text.strip()
        if not self.enabled:
            return None
        if self._translate_text_fn is not None:
            try:
                return (self._translate_text_fn(text) or "").strip() or None
            except Exception as exc:
                log.warning("Custom translate_text_fn failed: %s", exc)
                return None
        return self._translate_google(text)

    def _translate_title_text(self, title: str) -> Optional[str]:
        m = AT_PREFIX_RE.match(title)
        if m:
            prefix, rest = m.group(1), m.group(2)
            translated_rest = self.translate_text(rest)
            return f"{prefix}{translated_rest}" if translated_rest else None
        return self.translate_text(title)

    def translate_article(
        self,
        *,
        url: str,
        title: str,
        body: str,
    ) -> TranslatedArticle:
        """외국어 기사만 감지해 번역하고 URL 캐시를 재사용한다. 실패해도 예외 없이 안전 반환."""
        clean_title = re.sub(r"\s+", " ", title or "").strip()
        clean_body = clean_source_boilerplate(body)[:MAX_TRANSLATE_BODY_CHARS]

        title_foreign = needs_translation(clean_title)
        body_foreign = bool(clean_body) and needs_translation(clean_body)

        if not title_foreign and not body_foreign:
            self.stats["skipped_ko"] += 1
            return TranslatedArticle(
                original_title=clean_title,
                title_ko=clean_title,
                body_ko=clean_body,
                translated=False,
                provider="native_ko",
            )

        # 1) URL 캐시 조회
        if self.cache is not None:
            cached = self.cache.get(url)
            if cached is not None:
                cached_title = str(cached.get("title_ko") or "").strip()
                cached_body = str(cached.get("body_ko") or "").strip()
                if cached_title and not needs_translation(cached_title) and (not body_foreign or not needs_translation(cached_body)):
                    self.stats["cache_hits"] += 1
                    return TranslatedArticle(
                        original_title=str(cached.get("original_title") or clean_title),
                        title_ko=cached_title,
                        body_ko=cached_body,
                        translated=True,
                        provider=str(cached.get("provider") or "cache"),
                        why_ko=str(cached.get("why_ko") or "").strip() or None,
                        caveats_ko=str(cached.get("caveats_ko") or "").strip() or None,
                    )

        if not self.enabled:
            self.stats["fallbacks"] += 1
            return TranslatedArticle(
                original_title=clean_title,
                title_ko=clean_title,
                body_ko="" if body_foreign else clean_body,
                translated=False,
                provider="disabled",
            )

        title_ko: Optional[str] = None if title_foreign else clean_title
        body_ko: Optional[str] = None if body_foreign else clean_body
        why_ko: Optional[str] = None
        provider = "fallback"

        # 2) 커스텀 번역기(테스트) 또는 LLM(Anthropic → Gemini) → 0원 GoogleTranslator
        if self._translate_text_fn is None:
            llm_out = self._translate_with_anthropic(clean_title, clean_body)
            if llm_out:
                provider = "anthropic"
            else:
                llm_out = self._translate_with_gemini(clean_title, clean_body)
                if llm_out:
                    provider = "gemini"
            if llm_out:
                if title_foreign and llm_out.get("title_ko"):
                    title_ko = llm_out["title_ko"]
                if body_foreign and llm_out.get("body_ko"):
                    body_ko = llm_out["body_ko"]
                why_ko = llm_out.get("why_ko") or None

        if title_foreign and not title_ko:
            if RELEASE_TITLE_RE.match(clean_title):
                clean_ver = re.sub(r"\s+Release\s+", " ", clean_title, flags=re.I)
                title_ko = f"{clean_ver} 새 버전 공개"
                provider = "release_formatter"
            elif REPO_ID_RE.match(clean_title):
                title_ko = f"{clean_title} 오픈 모델 공개"
                provider = "repo_formatter"
            else:
                tr_title = self._translate_title_text(clean_title)
                if tr_title:
                    title_ko = tr_title
                    provider = "custom" if self._translate_text_fn else "deep_translator"
        if title_ko and needs_translation(title_ko):
            if RELEASE_TITLE_RE.match(clean_title):
                clean_ver = re.sub(r"\s+Release\s+", " ", clean_title, flags=re.I)
                title_ko = f"{clean_ver} 새 버전 공개"
            elif REPO_ID_RE.match(clean_title):
                title_ko = f"{clean_title} 오픈 모델 공개"
            elif self._translate_text_fn is None and provider != "fallback":
                # 고유명사 위주 제목이라 번역 후에도 한글 비중이 낮으면 한국어 안내 구문을 자연스럽게 덧붙임
                title_ko = f"{title_ko} 최신 소식"

        if body_foreign and not body_ko and clean_body:
            tr_body = self.translate_text(clean_body)
            if tr_body:
                body_ko = tr_body
                if provider == "fallback":
                    provider = "custom" if self._translate_text_fn else "deep_translator"

        # 번역 결과 안전 검증: 본문 번역 실패 시 원문 외국어 문장이 그대로 섞이지 않도록 빈 문자열 처리
        if body_ko and needs_translation(body_ko):
            body_ko = ""

        did_translate = bool((title_foreign and title_ko and not needs_translation(title_ko)) or (body_foreign and body_ko))
        final_title = title_ko or clean_title
        final_body = body_ko or ""

        if did_translate:
            self.stats["translated"] += 1
            if self.cache is not None and not needs_translation(final_title):
                self.cache.put(
                    url,
                    original_title=clean_title,
                    title_ko=final_title,
                    body_ko=final_body,
                    provider=provider,
                    why_ko=why_ko,
                )
        else:
            self.stats["fallbacks"] += 1

        return TranslatedArticle(
            original_title=clean_title,
            title_ko=final_title,
            body_ko=final_body,
            translated=did_translate,
            provider=provider,
            why_ko=why_ko,
        )
