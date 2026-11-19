"""AI Radar · 요약기 입출력 스키마 (pydantic).

LLM 응답은 structured outputs 로 SummaryLLMOutput 스키마에 강제된다.
필드 선언 순서 = JSON 출력 순서이므로 `_fact_sheet` 가 반드시 맨 앞에 와야 한다
(먼저 영어로 팩트를 고정 → 그 팩트만 근거로 한국어 요약 생성 = 단일 호출 CoT).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"]
EntityKind = Literal["model", "tool", "dataset", "company", "technique", "platform"]


# ─────────────────────────────────────────────────────────────────────────────
# 입력: 수집된 원본 1건 (Step 3 파이프라인이 items 행 + 원문 텍스트로 채워서 넘김)
# ─────────────────────────────────────────────────────────────────────────────
class SummaryInput(BaseModel):
    item_id: Optional[str] = None          # DB 저장 시 필요. 테스트 스크립트에선 None
    platform_id: str
    platform_name: Optional[str] = None    # 없으면 platform_id 로 대체
    source_name: str
    category: Category
    original_title: str
    canonical_url: str
    body: str = ""                         # 초록 / 릴리스 노트 / 설명문 등 원문 텍스트
    metrics: dict = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# 출력 1단계: 내부용 팩트시트 (영어, 원문에 없는 값은 null)
# ─────────────────────────────────────────────────────────────────────────────
class FactMetric(BaseModel):
    name: str = Field(description="What was measured, in English (e.g. 'decoding speedup')")
    value: Optional[str] = Field(description="Exact value as written in the source, or null if not stated")
    compared_to: Optional[str] = Field(description="Baseline it was compared against, or null if not stated")


class FactSheet(BaseModel):
    what_it_is: str = Field(description="One English sentence: what this item is (paper / model / tool / release / post)")
    key_claims: list[str] = Field(description="Main claims stated in the source, in English, 1-5 items")
    metrics: list[FactMetric] = Field(description="Numbers explicitly stated in the source. Empty list if none")
    compared_against: list[str] = Field(description="Models/tools/methods the source compares against. Empty if none")
    license: Optional[str] = Field(description="License as stated in the source, or null")
    availability: Optional[str] = Field(description="How people can access it (open weights, free demo, paid API...) as stated, or null")
    limitations: list[str] = Field(description="Limitations/risks stated in the source. Empty if none")
    not_stated: list[str] = Field(description="Things a reader would want to know but the source does NOT say")


# ─────────────────────────────────────────────────────────────────────────────
# 출력 2단계: 뉴닉풍 한국어 요약 (팩트시트만 근거)
# ─────────────────────────────────────────────────────────────────────────────
class Term(BaseModel):
    term: str = Field(description="용어 원문 표기. 한국어 본문에 이 문자열이 그대로 등장해야 함 (툴팁 밑줄용)")
    display_name: str = Field(description="사전 표시명, 예: '양자화 (Quantization)'")
    easy: str = Field(description="초등학생도 이해하는 1문장 비유 풀이, ~예요/~거든요 체")


class Entity(BaseModel):
    name: str
    kind: EntityKind
    tags: list[str] = Field(description="lowercase-kebab English tags, e.g. ['local-llm','coding']")


class SummaryLLMOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fact_sheet: FactSheet = Field(alias="_fact_sheet")      # ← 반드시 첫 필드
    hook_title: str
    context_ko: str
    what_ko: str
    analogy_ko: Optional[str]
    why_ko: str
    caveats_ko: Optional[str]
    difficulty: Literal[1, 2, 3]
    terms: list[Term]
    extracted_entities: list[Entity]


# ─────────────────────────────────────────────────────────────────────────────
# 요약기 최종 반환값 (DB 저장 직전 형태 + 품질 경고)
# ─────────────────────────────────────────────────────────────────────────────
class SummaryResult(BaseModel):
    output: SummaryLLMOutput
    prompt_version: str
    model: str
    warnings: list[str] = Field(default_factory=list)
    usage: dict = Field(default_factory=dict)

    def to_summary_row(self, item_id: str) -> dict:
        """public.summaries 테이블 1행."""
        o = self.output
        return {
            "item_id": item_id,
            "hook_title": o.hook_title,
            "context_ko": o.context_ko,
            "what_ko": o.what_ko,
            "analogy_ko": o.analogy_ko,
            "why_ko": o.why_ko,
            "caveats_ko": o.caveats_ko,
            "difficulty": o.difficulty,
            # 명세 포맷 그대로: [{"term","easy"}]
            "terms_json": [{"term": t.term, "easy": t.easy} for t in o.terms],
            "extracted_entities": [e.model_dump() for e in o.extracted_entities],
            "prompt_version": self.prompt_version,
        }

    def to_glossary_rows(self) -> list[dict]:
        """public.glossary 후보 행 (term 은 소문자·trim 정규화 — DB CHECK 제약과 동일 규칙)."""
        rows: dict[str, dict] = {}
        for t in self.output.terms:
            key = normalize_term(t.term)
            if key and key not in rows:
                rows[key] = {"term": key, "display_name": t.display_name.strip(), "easy_def": t.easy.strip()}
        return list(rows.values())


def normalize_term(term: str) -> str:
    return term.strip().lower()
