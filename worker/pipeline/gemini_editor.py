"""Gemini 배치 에디터 — 제목·쉬운 요약·미래 비전을 초보자용 대화체로 다듬는다.

- 8건씩 JSON 배열 배치, 배치 사이 4초 (무료 한도 방어), 모델 체인은 GeminiClient 가 폴백
- 결과는 canonical_url 기준으로 메타 파일에 영구 캐시 → 15분 크론에선 새 기사만 호출
- 검증 실패(가나·한자·말머리·상투구·원문에 없는 숫자)한 필드는 버리고 규칙 결과를 유지한다
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from pipeline.enrich import STOCK_PHRASE_RE, SENT_SPLIT_RE, _body_candidates, clean_text
from pipeline.ko_restore import ORIGINAL_FORM_RULE, restore_originals

logger = logging.getLogger("ai_radar.editor")

EDITOR_CACHE_KEY = "editor_cache"
EDITOR_VERSION = 2
BATCH_SIZE = 8
BATCH_GAP_SEC = 4.0
DEFAULT_MAX_BATCHES = 16
NOT_AI_KEEP_DAYS = 30          # is_ai_related=false 판정 URL 보관 기간 (재수집 시 Gemini 없이 즉시 탈락)

CJK_FOREIGN_RE = re.compile(r"[぀-ヿ一-鿿ｦ-ﾟ]")
BRACKET_HEAD_RE = re.compile(r"^\s*[\[【〔(（<〈「『]")
JARGON_RE = re.compile(r"(벤더|원가|생태계 지형|시그널이라|기준점이 돼요|패러다임|레버리지|시너지|인사이트를 제공)")
LITERAL_RE = re.compile(r"(의 만드는|을 를|를 을|에 대한 에 대한|하는 것을 하는|이 가 )")
NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")

PROMPT_HEAD = f"""너는 AI 뉴스를 처음 보는 사람에게 설명하는 한국어 뉴스 에디터야.
아래 JSON 배열의 기사마다 다음 3가지를 써 줘. 반드시 원문(original_title, title_ko, body)에 있는 사실만 써.
본문이 짧으면 제목과 출처·분야 정보만으로 '무슨 소식인지'를 풀어 쓰고, 숫자·이름·날짜를 지어내지 마.

1) title_ko: 자연스러운 한국어 헤드라인 18~45자. 친근한 대화체로 끝내(예: ~했어요 / ~나왔어요 / ~예요 / 궁금증을 주는 ~?).
   맨 앞에 [ ]·【 】 같은 말머리를 붙이지 마. 일본어 가나·중국어 한자는 절대 쓰지 말고 고유명사는 영문이나 한글로 써.
2) summary: 초보자가 바로 이해하는 쉬운 대화체 2문장. 두 문장 모두 '~요.'로 끝내.
   제목을 그대로 되풀이하지 말고, 무엇이 새로 나왔는지/무엇이 달라졌는지 구체적으로. 전문 용어는 짧게 풀어 써.
3) vision: 이 기사만의 미래 이야기 2문장. 첫 문장은 '앞으로 ~' 로 시작해 이 변화로 일상이나 업무에서 무엇이 가능해지는지,
   둘째 문장은 '우리는 ~에 주목해 볼 수 있어요.' 형태로 이 기사에 맞는 구체적인 관찰 포인트.
금지 표현: 벤더, 원가, 생태계 지형, 시그널, 패러다임, 인사이트, '쉽게 말해', '~에 따르면', '~를 발표했다' 같은 번역투, 다른 기사와 똑같은 문장.
4) is_ai_related: 기사가 AI(모델·에이전트·AI 제품·AI 연구·AI 산업·AI 정책)와 직접 관련 있으면 true,
   AI 와 무관한 일반 개발 도구·디스크 정리 같은 유틸리티·일반 보안 사건·단순 하드웨어 소식이면 false (false 면 나머지 필드는 빈 문자열).
5) glossary: 이 기사에 나온, 초보자가 어려워할 영문 약어·기술 개념 최대 4개. term 은 기사 표기 그대로,
   desc 는 '~요.'로 끝나는 쉬운 비유 1문장 (없으면 []).
표기 원칙: {ORIGINAL_FORM_RULE}

출력은 JSON 배열만: [{{"id": "...", "is_ai_related": true, "title_ko": "...", "summary": "...", "vision": "...", "glossary": [{{"term": "MCP", "desc": "AI가 내 파일이나 외부 앱을 직접 연결해 쓰도록 만든 표준 플러그 규격이에요."}}]}}]

기사 목록:
"""


def _source_blob(item: dict[str, Any]) -> str:
    body = " ".join(_body_candidates(item))
    return clean_text(f"{item.get('original_title') or ''} {item.get('title_ko') or ''} {body}")[:1400]


def source_hash(item: dict[str, Any]) -> str:
    # title_ko 는 에디터가 덮어쓰므로 해시에서 제외 (원문 제목 + 원문 본문만)
    body = clean_text(" ".join(_body_candidates(item)))[:400]
    raw = f"{EDITOR_VERSION}|{item.get('original_title') or ''}|{body}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_SPLIT_RE.split(text or "") if s.strip()]


def _numbers_grounded(text: str, source: str) -> bool:
    src = source.replace(",", "")
    return all(n.replace(",", "") in src for n in NUM_RE.findall(text))


def valid_title(t: str, source: str) -> bool:
    t = (t or "").strip()
    return (
        8 <= len(t) <= 70
        and not CJK_FOREIGN_RE.search(t)
        and not BRACKET_HEAD_RE.search(t)
        and not LITERAL_RE.search(t)
        and _numbers_grounded(t, source)
    )


def valid_summary(s: str, source: str) -> bool:
    sents = _sentences(s)
    return (
        2 <= len(sents) <= 3
        and all(x.rstrip(".!?").endswith("요") for x in sents)
        and 30 <= len(s) <= 320
        and not CJK_FOREIGN_RE.search(s)
        and not STOCK_PHRASE_RE.search(s)
        and not JARGON_RE.search(s)
        and not LITERAL_RE.search(s)
        and "쉽게 말해" not in s
        and _numbers_grounded(s, source)
    )


def valid_vision(v: str, source: str) -> bool:
    sents = _sentences(v)
    return (
        len(sents) >= 2
        and v.startswith("앞으로")
        and "주목" in v
        and all(x.rstrip(".!?").endswith("요") for x in sents)
        and len(v) <= 320
        and not CJK_FOREIGN_RE.search(v)
        and not JARGON_RE.search(v)
        and _numbers_grounded(v, source)
    )


def valid_glossary(raw: Any) -> list[dict[str, str]]:
    """Gemini glossary 검증: 최대 4개, 용어 1~30자, 쉬운 풀이 8~140자 '~요.' 로 끝, 한자·가나 없음."""
    out: list[dict[str, str]] = []
    for g in raw if isinstance(raw, list) else []:
        if not isinstance(g, dict):
            continue
        term = restore_originals(clean_text(g.get("term")))
        desc = restore_originals(clean_text(g.get("desc")))
        if not term or len(term) > 30 or CJK_FOREIGN_RE.search(term) or CJK_FOREIGN_RE.search(desc):
            continue
        if not (8 <= len(desc) <= 140) or not desc.rstrip(".!").endswith("요"):
            continue
        if any(x["term"].lower() == term.lower() for x in out):
            continue
        out.append({"term": term, "desc": desc})
        if len(out) >= 4:
            break
    return out


def apply_cached(item: dict[str, Any], cache: dict[str, Any]) -> bool:
    entry = cache.get(str(item.get("canonical_url") or ""))
    if not isinstance(entry, dict) or entry.get("src") != source_hash(item):
        return False
    if entry.get("title_ko"):
        item["title_ko"] = item["hook_title"] = entry["title_ko"]
    if entry.get("easy_summary_ko"):
        item["easy_summary_ko"] = entry["easy_summary_ko"]
    if entry.get("vision_ko"):
        item["vision_ko"] = entry["vision_ko"]
    if entry.get("glossary"):
        item["glossary"] = entry["glossary"]          # live-feed 선택 필드 (planning-feed 스키마에는 넣지 않는다)
    # 세 필드가 모두 검증 통과했을 때만 '완료' — 일부만 통과했으면 다음 실행에서 다시 다듬는다
    return all(entry.get(k) for k in ("title_ko", "easy_summary_ko", "vision_ko"))


def _batch_payload(batch: list[dict[str, Any]], names: dict[str, str]) -> str:
    rows = [
        {
            "id": it.get("id"),
            "source": names.get(str(it.get("platform_id")), str(it.get("platform_id"))),
            "category": it.get("category"),
            "original_title": it.get("original_title"),
            "title_ko": it.get("title_ko"),
            "body": " ".join(_body_candidates(it))[:900],
        }
        for it in batch
    ]
    return PROMPT_HEAD + json.dumps(rows, ensure_ascii=False)


def edit_items(
    items: list[dict[str, Any]],
    cache: dict[str, Any],
    gemini: Any,
    *,
    now: datetime,
    names: Optional[dict[str, str]] = None,
    sleep: Callable[[float], None] = time.sleep,
    max_batches: Optional[int] = None,
) -> dict[str, int]:
    names = names or {}
    max_batches = max_batches if max_batches is not None else int(os.getenv("EDITOR_MAX_BATCHES", DEFAULT_MAX_BATCHES))
    stats = {"cached": 0, "edited": 0, "rejected_fields": 0, "batches": 0, "failed_batches": 0}
    stats["not_ai"] = 0
    todo = []
    for it in items:
        if (cache.get(str(it.get("canonical_url") or "")) or {}).get("not_ai"):
            stats["not_ai"] += 1                        # 이미 비AI 판정 → Gemini 다시 부르지 않음 (호출부가 탈락시킴)
            continue
        if apply_cached(it, cache):
            stats["cached"] += 1
        else:
            todo.append(it)
    if gemini is None:
        return stats
    now_iso = now.isoformat().replace("+00:00", "Z")
    for start in range(0, len(todo), BATCH_SIZE):
        if stats["batches"] >= max_batches:
            break
        batch = todo[start:start + BATCH_SIZE]
        if stats["batches"]:
            sleep(BATCH_GAP_SEC)
        stats["batches"] += 1
        try:
            out, model = gemini.generate_json(_batch_payload(batch, names))
        except Exception as e:  # noqa: BLE001 - 배치 실패는 규칙 결과 유지
            stats["failed_batches"] += 1
            logger.warning("editor batch failed: %s", type(e).__name__)
            continue
        rows = out if isinstance(out, list) else (out.get("items") if isinstance(out, dict) else None) or []
        by_id = {str(r.get("id")): r for r in rows if isinstance(r, dict)}
        for it in batch:
            r = by_id.get(str(it.get("id")))
            if not r:
                continue
            if r.get("is_ai_related") is False:
                cache[str(it.get("canonical_url") or "")] = {"src": source_hash(it), "model": model, "at": now_iso, "not_ai": True}
                stats["not_ai"] += 1
                continue
            source = _source_blob(it)
            entry: dict[str, Any] = {"src": source_hash(it), "model": model, "at": now_iso}
            # 억지 한글 음차(엠시피·이 년)는 검증 전에 원형(MCP·2년)으로 되돌린다
            title, summary, vision = (restore_originals(clean_text(r.get(k))) for k in ("title_ko", "summary", "vision"))
            glossary = valid_glossary(r.get("glossary"))
            if glossary:
                entry["glossary"] = glossary
            for key, value, ok in (
                ("title_ko", title, valid_title(title, source)),
                ("easy_summary_ko", summary, valid_summary(summary, source)),
                ("vision_ko", vision, valid_vision(vision, source)),
            ):
                if ok:
                    entry[key] = value
                else:
                    stats["rejected_fields"] += 1
            if any(k in entry for k in ("title_ko", "easy_summary_ko", "vision_ko")):
                prev = cache.get(str(it.get("canonical_url") or "")) or {}
                if prev.get("src") == entry["src"]:
                    entry = {**{k: v for k, v in prev.items() if k in ("title_ko", "easy_summary_ko", "vision_ko", "glossary")}, **entry}
                cache[str(it.get("canonical_url") or "")] = entry
                apply_cached(it, cache)
                stats["edited"] += 1

    live = {str(it.get("canonical_url") or "") for it in items}
    block_cutoff = now - timedelta(days=NOT_AI_KEEP_DAYS)

    def _keep_block(entry: Any) -> bool:
        # 비AI 판정은 피드에서 빠진 뒤에도 30일 보관 → 같은 글이 다시 수집돼도 Gemini 호출 없이 바로 탈락
        if not (isinstance(entry, dict) and entry.get("not_ai")):
            return False
        try:
            return datetime.fromisoformat(str(entry.get("at")).replace("Z", "+00:00")) >= block_cutoff
        except ValueError:
            return False

    for key in [k for k in cache if k not in live and not _keep_block(cache[k])]:
        cache.pop(key, None)
    return stats
