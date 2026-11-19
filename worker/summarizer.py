"""AI Radar · 뉴닉 톤 요약기 (단일 호출 Fact-First CoT).

- LLM 호출은 아이템당 정확히 1회. 재시도/2차 교정 호출 없음 (SDK 의 네트워크 재시도만 존재).
- structured outputs 로 SummaryLLMOutput 스키마 강제 → `_fact_sheet` 먼저, 그 뒤 한국어 필드.
- 결과 품질은 후처리 린트(금지어 / 팩트시트에 없는 숫자 / 툴팁 용어 누락)로 `warnings` 에 기록만 한다.
- DB 입출력(glossary 조회·summaries 저장·glossary upsert)은 supabase 클라이언트를 인자로 받는 얇은 함수로 분리.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import anthropic

from prompts import newneek_v1 as P
from summarizer_schema import SummaryInput, SummaryLLMOutput, SummaryResult, normalize_term

log = logging.getLogger("ai_radar.summarizer")

DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_EFFORT = "low"           # 팩트시트가 CoT 역할을 하므로 추가 thinking 은 최소로 (비용 고정)
DEFAULT_MAX_TOKENS = 8000        # thinking + JSON 출력 여유분
MAX_BODY_CHARS = 12_000          # 원문 상한. 넘으면 잘라내고 warnings 에 명시
GLOSSARY_CONTEXT_LIMIT = 40      # 프롬프트에 넣을 기존 용어 최대 개수


class SummarizeError(RuntimeError):
    """요약 실패 (파이프라인은 이 아이템만 건너뛰고 계속 진행)."""


class SummaryRefused(SummarizeError):
    pass


class SummaryTruncated(SummarizeError):
    pass


class Summarizer:
    def __init__(
        self,
        client: Optional[anthropic.Anthropic] = None,
        *,
        model: Optional[str] = None,
        effort: str = DEFAULT_EFFORT,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> None:
        self.client = client or anthropic.Anthropic()
        self.model = model or os.getenv("SUMMARIZER_MODEL", DEFAULT_MODEL)
        self.effort = effort
        self.max_tokens = max_tokens

    # ── public ──────────────────────────────────────────────────────────────
    def summarize(self, item: SummaryInput, glossary: Optional[list[dict]] = None) -> SummaryResult:
        warnings: list[str] = []

        body = item.body or ""
        if len(body) > MAX_BODY_CHARS:
            warnings.append(f"body_truncated: {len(body)} -> {MAX_BODY_CHARS} chars")
            body = body[:MAX_BODY_CHARS] + "\n[...원문이 길어서 뒷부분 생략]"

        relevant = select_relevant_glossary(glossary or [], f"{item.original_title}\n{body}")
        user_msg = P.build_user_message(
            platform_name=item.platform_name or item.platform_id,
            source_name=item.source_name,
            category=item.category,
            title=item.original_title,
            url=item.canonical_url,
            body=body,
            metrics=item.metrics,
            glossary_lines=[glossary_line(g) for g in relevant],
        )

        resp = self.client.messages.parse(
            model=self.model,
            max_tokens=self.max_tokens,
            # 고정 system(규칙+few-shot) 에 캐시 브레이크포인트. 바뀌는 값은 전부 user 메시지에.
            system=[{"type": "text", "text": P.SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_msg}],
            output_config={"effort": self.effort},
            output_format=SummaryLLMOutput,
        )

        if resp.stop_reason == "refusal":
            category = getattr(resp.stop_details, "category", None) if resp.stop_details else None
            raise SummaryRefused(f"model refused (category={category}) for {item.canonical_url}")
        if resp.stop_reason == "max_tokens":
            raise SummaryTruncated(f"hit max_tokens={self.max_tokens} for {item.canonical_url}")
        if resp.parsed_output is None:
            raise SummarizeError(f"no parsed output (stop_reason={resp.stop_reason}) for {item.canonical_url}")

        out: SummaryLLMOutput = resp.parsed_output
        warnings.extend(lint_output(out))
        for w in warnings:
            log.warning("[%s] %s", item.canonical_url, w)

        return SummaryResult(
            output=out,
            prompt_version=P.PROMPT_VERSION,
            model=resp.model,
            warnings=warnings,
            usage=resp.usage.model_dump(exclude_none=True) if resp.usage else {},
        )


# ─────────────────────────────────────────────────────────────────────────────
# glossary 컨텍스트
# ─────────────────────────────────────────────────────────────────────────────
def select_relevant_glossary(glossary: list[dict], text: str, limit: int = GLOSSARY_CONTEXT_LIMIT) -> list[dict]:
    """원문에 실제로 등장하는 용어만 골라 프롬프트에 넣는다 (토큰 절약 + 일관성)."""
    haystack = text.lower()
    picked = []
    for g in glossary:
        term = normalize_term(g.get("term", ""))
        display = (g.get("display_name") or "").lower()
        # display_name 의 괄호 안 영문 표기도 매칭 후보: '양자화 (quantization)' → 'quantization'
        aliases = {term} | set(re.findall(r"\(([^)]+)\)", display)) | {display.split("(")[0].strip()}
        if any(a and a in haystack for a in aliases):
            picked.append(g)
        if len(picked) >= limit:
            break
    return picked


def glossary_line(g: dict) -> str:
    return f"- {g.get('display_name') or g['term']}: {g['easy_def']}"


# ─────────────────────────────────────────────────────────────────────────────
# 후처리 린트 (재호출하지 않고 경고만)
# ─────────────────────────────────────────────────────────────────────────────
_KO_FIELDS = ("hook_title", "benefit_tag", "context_ko", "what_ko", "analogy_ko", "why_ko", "caveats_ko")
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")


def lint_output(out: SummaryLLMOutput) -> list[str]:
    warnings: list[str] = []
    ko_text = "\n".join(getattr(out, f) or "" for f in _KO_FIELDS)

    for phrase in P.BANNED_PHRASES:
        if phrase in ko_text:
            warnings.append(f"banned_phrase: '{phrase}'")

    # 한국어 본문의 숫자가 팩트시트(+용어 풀이)에 없으면 지어낸 수치일 가능성
    fact_text = json.dumps(out.fact_sheet.model_dump(), ensure_ascii=False)
    fact_nums = set(_NUM_RE.findall(fact_text))
    for n in sorted(set(_NUM_RE.findall(ko_text))):
        if n not in fact_nums and n not in {"1", "2", "3"}:   # '한두 개', '세 줄' 류 소수는 허용
            warnings.append(f"number_not_in_fact_sheet: '{n}'")

    if out.benefit_tag and len(out.benefit_tag.strip()) > P.BENEFIT_TAG_MAX:
        warnings.append(f"benefit_tag_too_long: {len(out.benefit_tag.strip())} > {P.BENEFIT_TAG_MAX}")

    for t in out.terms:
        if t.term not in ko_text:
            warnings.append(f"term_not_in_body: '{t.term}' (툴팁 밑줄을 달 수 없음)")

    return warnings


# ─────────────────────────────────────────────────────────────────────────────
# DB I/O (supabase-py, service_role 키 사용 — RLS 우회)
# ─────────────────────────────────────────────────────────────────────────────
def fetch_glossary(sb: Any, limit: int = 500) -> list[dict]:
    res = (
        sb.table("glossary")
        .select("term,display_name,easy_def")
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def save_summary(sb: Any, item_id: str, result: SummaryResult) -> None:
    """summaries upsert + 새 용어만 glossary 에 추가 (기존 풀이는 덮어쓰지 않아 일관성 유지)."""
    sb.table("summaries").upsert(result.to_summary_row(item_id), on_conflict="item_id").execute()
    rows = result.to_glossary_rows()
    if rows:
        sb.table("glossary").upsert(rows, on_conflict="term", ignore_duplicates=True).execute()
