"""AI 순도 게이트 (web/edge/ai-gate.ts 와 같은 규칙) + Gemini is_ai_related=false 즉시 탈락."""
from datetime import datetime, timedelta, timezone

from pipeline.ai_gate import is_ai_candidate, is_ai_item, is_ai_signal
from pipeline.gemini_editor import edit_items

NOW = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)


def test_title_signal_passes_and_general_it_is_blocked():
    for t in ("오픈AI, 새 에이전트 공개", "做了个 AI 浏览器插件", "Claude Code 활용법", "llms.txt の設置率", "Dify Enterprise 社内展開"):
        assert is_ai_signal(t), t
    for t in ("分享一个开源磁盘清理、文件搜索工具", "压缩PNG不损失透明：只量化RGB", "러스트 1.90 릴리스",
              "受够锁机软件收费，给安卓写了个免费无广的防冲动戒手机工具"):
        assert not is_ai_signal(t), t


def test_body_needs_two_distinct_signals_and_no_negative():
    assert not is_ai_signal("새 노트 앱 출시", "요즘 AI 시대라지만 이 앱은 그냥 메모장이다")
    assert is_ai_signal("주말에 만든 사이드 프로젝트", "LLM 으로 요약하고 에이전트가 일정까지 잡아 준다")
    assert not is_ai_signal("맥 정리 도구", "디스크 정리 — AI 추천, LLM 분류")


def test_only_general_it_platforms_are_gated():
    assert is_ai_candidate("openai", "Searching for distant planets")
    assert not is_ai_candidate("v2ex", "分享一个开源磁盘清理、文件搜索工具")
    assert not is_ai_item({"platform_id": "juejin", "original_title": "压缩PNG不损失透明", "title_ko": "PNG 압축", "what_ko": "투명도 손실 없이 압축해요."})
    assert is_ai_item({"platform_id": "geeknews", "original_title": "ShellBench - 실제 에이전트 사용 패턴으로 만든 벤치마크"})


class FakeGemini:
    def __init__(self):
        self.calls = 0

    def generate_json(self, prompt):
        assert "is_ai_related" in prompt
        self.calls += 1
        return [{"id": "a", "is_ai_related": False, "title_ko": "", "summary": "", "vision": ""}], "fake-model"


def test_gemini_not_ai_is_cached_skipped_and_kept_for_30_days():
    item = {"id": "a", "canonical_url": "https://www.v2ex.com/t/1", "platform_id": "v2ex", "original_title": "做了个小工具", "title_ko": "작은 도구"}
    cache: dict = {}
    g = FakeGemini()
    s1 = edit_items([dict(item)], cache, g, now=NOW, sleep=lambda _: None, max_batches=1)
    assert s1["not_ai"] == 1 and cache[item["canonical_url"]]["not_ai"] is True
    s2 = edit_items([dict(item)], cache, g, now=NOW, sleep=lambda _: None, max_batches=1)
    assert s2["not_ai"] == 1 and g.calls == 1                       # 두 번째는 Gemini 호출 없음
    edit_items([], cache, g, now=NOW + timedelta(days=10), sleep=lambda _: None)
    assert item["canonical_url"] in cache                            # 피드에서 빠져도 차단 목록 유지
    edit_items([], cache, g, now=NOW + timedelta(days=31), sleep=lambda _: None)
    assert item["canonical_url"] not in cache                        # 30일 뒤 정리
