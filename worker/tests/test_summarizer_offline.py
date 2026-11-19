"""API 호출 없이 도는 요약기 단위 테스트.  실행: (worker/ 에서) python -m pytest -q"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import TypeAdapter  # noqa: E402
from anthropic.lib._parse._transform import transform_schema  # noqa: E402

from prompts import newneek_v1 as P  # noqa: E402
from summarizer import (  # noqa: E402
    SummarizeError, Summarizer, SummaryRefused, SummaryTruncated, lint_output, select_relevant_glossary,
)
from summarizer_schema import SummaryInput, SummaryLLMOutput  # noqa: E402

GOOD = {
    "_fact_sheet": {
        "what_it_is": "A tool.", "key_claims": ["fast"],
        "metrics": [{"name": "time", "value": "90 seconds", "compared_to": None}],
        "compared_against": [], "license": "CC BY-NC 4.0", "availability": None,
        "limitations": ["hands distorted"], "not_stated": [],
    },
    "hook_title": "사진 한 장이 춤을 춰요",
    "benefit_tag": "웹 데모 바로 체험",
    "context_ko": "원래는 어려웠거든요.",
    "what_ko": "한 클립에 90초 정도 걸린대요. LoRA 같은 건 안 써요.",
    "analogy_ko": None,
    "why_ko": "바로 해볼 수 있어요.",
    "caveats_ko": "손가락이 가끔 이상해요.",
    "difficulty": 1,
    "terms": [{"term": "LoRA", "display_name": "LoRA (Low-Rank Adaptation)", "easy": "작은 메모장이에요."}],
    "extracted_entities": [{"name": "Groove2Motion", "kind": "tool", "tags": ["video-generation"]}],
}

ITEM = SummaryInput(
    item_id=None, platform_id="huggingface", source_name="HF Trending Spaces", category="image_design",
    original_title="Groove2Motion", canonical_url="https://example.com/x", body="uses LoRA adapters",
)


def test_fact_sheet_is_first_property_in_sent_schema():
    schema = transform_schema(TypeAdapter(SummaryLLMOutput).json_schema())
    props = list(schema["properties"].keys())
    assert props[0] == "_fact_sheet"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(props)          # 모든 필드 필수 (nullable 은 null 로)


def test_alias_parses_fact_sheet():
    out = SummaryLLMOutput.model_validate(GOOD)
    assert out.fact_sheet.license == "CC BY-NC 4.0"
    assert out.model_dump(by_alias=True)["_fact_sheet"]["license"] == "CC BY-NC 4.0"


def test_lint_flags_banned_words_invented_numbers_and_missing_terms():
    bad = dict(GOOD, what_ko="혁신적인 도구로 무려 7배 빨라졌대요.",
               terms=[{"term": "ZeroGPU", "display_name": "ZeroGPU", "easy": "무료 GPU예요."}])
    warnings = lint_output(SummaryLLMOutput.model_validate(bad))
    assert any("혁신적" in w for w in warnings)
    assert any("'7'" in w for w in warnings)
    assert any("ZeroGPU" in w for w in warnings)


def test_lint_clean_on_good_output():
    assert lint_output(SummaryLLMOutput.model_validate(GOOD)) == []


def test_glossary_selection_matches_term_and_english_alias():
    glossary = [
        {"term": "lora", "display_name": "LoRA (Low-Rank Adaptation)", "easy_def": "a"},
        {"term": "양자화", "display_name": "양자화 (Quantization)", "easy_def": "b"},
        {"term": "moe", "display_name": "MoE", "easy_def": "c"},
    ]
    picked = select_relevant_glossary(glossary, "We apply LoRA and 4-bit quantization")
    assert [g["term"] for g in picked] == ["lora", "양자화"]


def test_rows_for_db():
    from summarizer_schema import SummaryResult
    r = SummaryResult(output=SummaryLLMOutput.model_validate(GOOD), prompt_version="v", model="m")
    row = r.to_summary_row("uuid-1")
    assert row["terms_json"] == [{"term": "LoRA", "easy": "작은 메모장이에요."}]
    assert row["extracted_entities"][0]["kind"] == "tool"
    assert r.to_glossary_rows() == [{"term": "lora", "display_name": "LoRA (Low-Rank Adaptation)", "easy_def": "작은 메모장이에요."}]


# ── 호출 형태 검증 (가짜 클라이언트) ─────────────────────────────────────────
class FakeMessages:
    def __init__(self, resp):
        self.resp, self.calls = resp, []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.resp


def fake_client(stop_reason="end_turn", parsed=True):
    resp = SimpleNamespace(
        stop_reason=stop_reason, stop_details=None, model="claude-haiku-5-5",
        parsed_output=SummaryLLMOutput.model_validate(GOOD) if parsed else None,
        usage=SimpleNamespace(model_dump=lambda **_: {"input_tokens": 10, "output_tokens": 5}),
    )
    return SimpleNamespace(messages=FakeMessages(resp))


def test_single_call_with_cached_system_and_no_sampling_params():
    client = fake_client()
    result = Summarizer(client).summarize(ITEM, glossary=[{"term": "lora", "display_name": "LoRA", "easy_def": "x"}])
    assert len(client.messages.calls) == 1                         # 정확히 1회 호출
    call = client.messages.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["system"][0]["text"] == P.SYSTEM_PROMPT            # 고정 system (캐시 가능)
    assert call["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert call["output_format"] is SummaryLLMOutput
    assert call["output_config"] == {"effort": "low"}
    assert not {"temperature", "top_p", "top_k"} & call.keys()     # Haiku 5.5 에선 400
    assert "- LoRA: x" in call["messages"][0]["content"]            # glossary 컨텍스트 주입
    assert result.prompt_version == P.PROMPT_VERSION


@pytest.mark.parametrize("stop, exc", [("refusal", SummaryRefused), ("max_tokens", SummaryTruncated)])
def test_stop_reasons_raise(stop, exc):
    with pytest.raises(exc):
        Summarizer(fake_client(stop_reason=stop)).summarize(ITEM)


def test_missing_parsed_output_raises():
    with pytest.raises(SummarizeError):
        Summarizer(fake_client(parsed=False)).summarize(ITEM)


def test_long_body_is_truncated_with_warning():
    client = fake_client()
    long_item = ITEM.model_copy(update={"body": "x" * 20_000})
    result = Summarizer(client).summarize(long_item)
    assert any(w.startswith("body_truncated") for w in result.warnings)
    assert "뒷부분 생략" in client.messages.calls[0]["messages"][0]["content"]


def test_benefit_tag_is_saved_and_linted():
    from summarizer_schema import SummaryResult
    r = SummaryResult(output=SummaryLLMOutput.model_validate(GOOD), prompt_version="v", model="m")
    assert r.to_summary_row("id")["benefit_tag"] == "웹 데모 바로 체험"
    long_tag = dict(GOOD, benefit_tag="이 도구 하나면 모든 작업이 다섯 배 빨라져요")
    assert any(w.startswith("benefit_tag_too_long") for w in lint_output(SummaryLLMOutput.model_validate(long_tag)))
    clickbait = dict(GOOD, hook_title="충격! 디자이너 끝났다")
    assert any("충격" in w for w in lint_output(SummaryLLMOutput.model_validate(clickbait)))
    none_tag = SummaryResult(output=SummaryLLMOutput.model_validate(dict(GOOD, benefit_tag=None)), prompt_version="v", model="m")
    assert none_tag.to_summary_row("id")["benefit_tag"] is None


def test_prompt_defines_source_difficulty_and_hook_angles():
    assert P.PROMPT_VERSION == "newneek-v1.1"
    for needle in ("원문 난이도", "박사급 논문", "benefit_tag", "돈·시간 절약", "통념", "무료로 써볼"):
        assert needle in P.SYSTEM_PROMPT, needle
