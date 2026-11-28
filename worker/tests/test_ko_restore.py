"""억지 한글 음차 복원 (web/edge/restore.ts 와 같은 표) + HF 업로드 판별 + Gemini glossary 검증."""
from datetime import datetime, timezone

import pytest

from pipeline.ai_gate import is_hf_upload
from pipeline.gemini_editor import PROMPT_HEAD, edit_items, valid_glossary
from pipeline.ko_restore import restore_item, restore_originals

NOW = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("before,after", [
    ("허깅페이스에 공개된 잉클링 투 미니 지지유에프가 나왔어요", "Hugging Face에 공개된 잉클링 투 미니 GGUF가 나왔어요"),
    ("그라디오와 엠시피 서버 기술을 활용했어요", "그라디오와 MCP 서버 기술을 활용했어요"),
    ("알리바바가 내부에서 이 년 동안 쓴 코드 검토 도구예요", "알리바바가 내부에서 2년 동안 쓴 코드 검토 도구예요"),
    ("오픈에이아이가 에스디케이와 에이피아이를 열었어요", "OpenAI가 SDK와 API를 열었어요"),
    ("속도가 열 배 빨라지고 비용은 70퍼센트 줄었어요", "속도가 10배 빨라지고 비용은 70% 줄었어요"),
    ("지피유 브이램이 부족해도 엘엘엠을 돌려요", "GPU VRAM이 부족해도 LLM을 돌려요"),
])
def test_restore_matches_ts_table(before, after):
    assert restore_originals(before) == after


@pytest.mark.parametrize("text", ["이 배터리는 오래가요", "세 배터리 제조사", "이 년도 계획", "2년 만에 나왔어요", "일주일 동안 써 봤어요", "MCP 서버"])
def test_restore_leaves_other_words(text):
    assert restore_originals(text) == text


def test_restore_item_keeps_keys_source_title_and_urls():
    item = {"id": "x", "original_title": "에이아이 raw", "canonical_url": "https://a.b/에이아이", "title_ko": "에이아이 소식",
            "planning_meta": {"signal_type": "엠시피 연동"}, "terms": [{"term": "엠시피", "easy": "엠시피 설명이에요."}]}
    out = restore_item(item)
    assert list(out) == list(item) and list(out["planning_meta"]) == list(item["planning_meta"])
    assert out["original_title"] == "에이아이 raw" and out["canonical_url"] == item["canonical_url"]
    assert out["title_ko"] == "AI 소식" and out["planning_meta"]["signal_type"] == "MCP 연동"
    assert out["terms"] == [{"term": "MCP", "easy": "MCP 설명이에요."}]


def test_hf_upload_detection_keeps_papers():
    assert is_hf_upload("https://huggingface.co/spaces/JCisHERE/wan2-2-i2v-v3")
    assert is_hf_upload("https://huggingface.co/thinkingmachines/Inkling-2-Mini")
    assert not is_hf_upload("https://huggingface.co/papers/2611.33885")
    assert not is_hf_upload("https://huggingface.co/blog/post")
    assert not is_hf_upload("https://arxiv.org/abs/2611.1")


def test_prompt_demands_original_forms_and_glossary():
    assert "엠시피" in PROMPT_HEAD and "2년" in PROMPT_HEAD and '"glossary"' in PROMPT_HEAD


def test_valid_glossary_caps_and_restores():
    g = valid_glossary([
        {"term": "엠시피", "desc": "AI가 외부 앱을 연결해 쓰도록 만든 표준 플러그예요."},
        {"term": "GGUF", "desc": "짧음"},
        {"term": "RAG", "desc": "AI가 먼저 문서를 찾아보고 답하는 방식이에요."},
        {"term": "rag", "desc": "중복된 용어 풀이는 하나만 남겨요."},
        {"term": "MoE", "desc": "질문마다 일부 전문가만 골라 쓰는 구조예요."},
        {"term": "LoRA", "desc": "작은 부품만 덧붙여 맞춤 학습하는 기법이에요."},
        {"term": "CUDA", "desc": "엔비디아 GPU 계산용 개발 플랫폼이에요."},
    ])
    assert [x["term"] for x in g] == ["MCP", "RAG", "MoE", "LoRA"]


class FakeGemini:
    def generate_json(self, prompt):
        return [{"id": "a", "is_ai_related": True, "title_ko": "큐원이 엠시피 에스디케이를 공개했어요",
                 "summary": "에이아이 앱 개발을 돕는 도구가 나왔어요. 누구나 바로 써 볼 수 있어요.",
                 "vision": "앞으로 앱끼리 연결이 쉬워져요. 우리는 연결 표준에 주목해 볼 수 있어요.",
                 "glossary": [{"term": "MCP", "desc": "AI가 외부 앱을 연결해 쓰도록 만든 표준 플러그 규격이에요."}]}], "fake"


def test_editor_restores_and_stores_glossary():
    item = {"id": "a", "canonical_url": "https://qwen.ai/x", "platform_id": "qwen", "original_title": "Qwen MCP SDK", "title_ko": "Qwen MCP SDK",
            "what_ko": "Qwen released an MCP SDK for AI apps."}
    cache: dict = {}
    edit_items([item], cache, FakeGemini(), now=NOW, sleep=lambda _: None, max_batches=1)
    assert item["title_ko"] == "큐원이 MCP SDK를 공개했어요"
    assert item["glossary"] == [{"term": "MCP", "desc": "AI가 외부 앱을 연결해 쓰도록 만든 표준 플러그 규격이에요."}]
    assert cache["https://qwen.ai/x"]["glossary"] == item["glossary"]
