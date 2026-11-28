"""억지 한글 음차 복원 — 영문 약어·제품명·숫자를 한글 소리로 풀어 쓴 것을 원형으로 되돌린다.

    엠시피 → MCP, 지지유에프 → GGUF, 허깅페이스 → Hugging Face, 이 년 → 2년, 열 배 → 10배, 70퍼센트 → 70%

web/edge/restore.ts 와 같은 표를 쓴다. 번역·요약 프롬프트에도 같은 원칙(ORIGINAL_FORM_RULE)을 넣는다.
"""

from __future__ import annotations

import re
from typing import Any

ORIGINAL_FORM_RULE = (
    "영문 모델명·회사·제품명과 기술 약어(MCP, GGUF, SDK, API, LLM, RAG, GPU, NPU, VRAM, CLI, MoE, LoRA, Agent, CUDA 등)는 "
    "'엠시피'·'지지유에프'처럼 한글 소리로 옮기지 말고 영문 대소문자 원형 그대로 쓰고, "
    "숫자도 '이 년'·'열 배'처럼 한글로 풀지 말고 2년·10배·30B·70% 처럼 아라비아 숫자 원형 그대로 쓰세요."
)

_TRANSLIT = sorted([
    ("챗지피티", "ChatGPT"), ("오픈에이아이", "OpenAI"), ("허깅페이스", "Hugging Face"), ("깃허브", "GitHub"),
    ("지지유에프", "GGUF"), ("에스디케이", "SDK"), ("에이피아이", "API"), ("엘엘엠", "LLM"), ("엠시피", "MCP"),
    ("알에이지", "RAG"), ("에이지아이", "AGI"), ("브이엘엠", "VLM"), ("브이램", "VRAM"), ("씨엘아이", "CLI"),
    ("엠오이", "MoE"), ("지피유", "GPU"), ("엔피유", "NPU"), ("티피유", "TPU"), ("티티에스", "TTS"), ("오씨알", "OCR"),
    ("아이디이", "IDE"), ("지피티", "GPT"), ("에이아이", "AI"),
], key=lambda kv: -len(kv[0]))

_SINO = {"일": "1", "이": "2", "삼": "3", "사": "4", "오": "5", "육": "6", "칠": "7", "팔": "8", "구": "9", "십": "10"}
_NATIVE = {"두": "2", "세": "3", "네": "4", "다섯": "5", "열": "10", "백": "100"}
# 숫자 단위 뒤에 올 수 있는 것: 끝·공백·문장부호 또는 조사·접미사 ('배터리'·'년도' 같은 다른 낱말은 제외)
_TAIL = r"(?=$|[\s.,!?)~·]|간|째|을|를|이|가|은|는|의|에|만|과|와|로|부터|까지|씩|나|쯤)"
_SINO_RE = re.compile(r"(^|[^가-힣0-9])(일|이|삼|사|오|육|칠|팔|구|십) ?(년|개월|주년|퍼센트)" + _TAIL)
_NATIVE_RE = re.compile(r"(^|[^가-힣0-9])(두|세|네|다섯|열|백) ?(배)" + _TAIL)
_PERCENT_RE = re.compile(r"(\d) ?퍼센트")

# 원문 제목·URL·ID·시각 등은 건드리지 않는다
_SKIP_KEYS = frozenset({
    "id", "dedup_key", "original_title", "canonical_url", "image_url", "thumbnail_url", "platform_id", "category",
    "published_at", "fetched_at", "first_seen_at", "created_at", "lifecycle_status", "author_handle", "source_platforms",
})


def restore_originals(text: str) -> str:
    if not text:
        return text
    out = text
    for ko, en in _TRANSLIT:
        if ko in out:
            out = out.replace(ko, en)
    out = _SINO_RE.sub(lambda m: f"{m.group(1)}{_SINO[m.group(2)]}{'%' if m.group(3) == '퍼센트' else m.group(3)}", out)
    out = _NATIVE_RE.sub(lambda m: f"{m.group(1)}{_NATIVE[m.group(2)]}{m.group(3)}", out)
    return _PERCENT_RE.sub(r"\1%", out)


def restore_item(value: Any, key: str = "") -> Any:
    """스냅샷 아이템 안의 화면용 한국어 문자열을 모두 복원 (키 구조는 그대로)."""
    if isinstance(value, str):
        return value if key in _SKIP_KEYS or key.endswith("_url") else restore_originals(value)
    if isinstance(value, list):
        return [restore_item(v, key) for v in value]
    if isinstance(value, dict):
        return {k: restore_item(v, k) for k, v in value.items()}
    return value
