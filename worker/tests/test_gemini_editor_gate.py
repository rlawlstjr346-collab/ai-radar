import io
from datetime import datetime, timezone

from PIL import Image

from pipeline.gemini_client import GeminiClient, _extract_text, parse_json_loose
from pipeline.gemini_editor import edit_items, valid_summary, valid_title, valid_vision
from pipeline.image_gate import is_text_card_url, pixel_verdict

NOW = datetime(2026, 11, 28, 9, 0, tzinfo=timezone.utc)


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_interactions_and_generate_content_text_extraction():
    inter = {"steps": [{"type": "thought", "signature": "x"}, {"type": "model_output", "content": [{"type": "text", "text": "[1]"}]}]}
    assert _extract_text(inter) == "[1]"
    legacy = {"candidates": [{"content": {"parts": [{"text": "{\"a\": 1}"}]}}]}
    assert parse_json_loose(_extract_text(legacy)) == {"a": 1}
    assert parse_json_loose("```json\n[{\"id\": 1}]\n```") == [{"id": 1}]


def test_aq_key_tries_vertex_first_then_genlang():
    assert GeminiClient(api_key="AQ.test")._routes("m")[0] == "vertex"
    assert GeminiClient(api_key="AIzaTest")._routes("m")[0] == "interactions"


def test_text_card_hosts_and_flat_pixels_are_rejected():
    assert is_text_card_url("https://res.cloudinary.com/zenn/image/upload/og.png")
    assert is_text_card_url("https://opengraph.githubassets.com/1/a/b")
    assert is_text_card_url("https://site.dev/api/og?title=hello")
    assert not is_text_card_url("https://cdn.aitimes.com/news/photo/202611/1.jpg")
    flat = Image.new("RGB", (600, 315), "white")
    for x in range(200, 400):
        for y in range(140, 170):
            flat.putpixel((x, y), (20, 20, 20))
    assert pixel_verdict(_png(Image.new("RGB", (600, 315), "white")))[0] is False
    assert pixel_verdict(_png(flat))[0] is False         # 흰 배경 + 글자 한 줄 = 거의 단색
    import random
    random.seed(1)
    noisy = Image.new("RGB", (300, 200))
    noisy.putdata([(random.randrange(256), random.randrange(256), random.randrange(256)) for _ in range(300 * 200)])
    assert pixel_verdict(_png(noisy))[0] is True


def test_editor_validation_blocks_kana_brackets_stock_and_invented_numbers():
    src = "OpenAI released GPT-9 Mini, 40% cheaper"
    assert valid_title("OpenAI가 더 싼 GPT-9 Mini를 내놨어요", src)
    assert not valid_title("[속보] GPT-9 Mini 공개", src)
    assert not valid_title("データ GPT-9 Mini", src)
    assert valid_summary("OpenAI가 새 작은 모델을 내놨어요. 값이 40% 더 싸요.", src)
    assert not valid_summary("OpenAI가 새 모델을 내놨어요. 값이 70% 더 싸요.", src)     # 원문에 없는 숫자
    assert not valid_summary("쉽게 말해 새 모델이에요. 벤더 전략이 바뀌어요.", src)
    assert valid_vision("앞으로 작은 기기에서도 AI를 쓰게 돼요. 우리는 무료 사용 범위에 주목해 볼 수 있어요.", src)


class FakeGemini:
    def __init__(self):
        self.calls = 0

    def generate_json(self, prompt, image=None):
        self.calls += 1
        return [{"id": "a", "title_ko": "OpenAI가 더 싼 GPT-9 Mini를 내놨어요",
                 "summary": "OpenAI가 새 작은 모델을 내놨어요. 값이 40% 더 싸요.",
                 "vision": "앞으로 작은 기기에서도 AI를 쓰게 돼요. 우리는 무료 사용 범위에 주목해 볼 수 있어요."}], "fake"


def test_editor_caches_and_skips_on_next_run():
    item = {"id": "a", "canonical_url": "https://n.site.kr/a", "original_title": "OpenAI released GPT-9 Mini, 40% cheaper",
            "title_ko": "GPT-9 Mini 공개", "hook_title": "GPT-9 Mini 공개"}
    cache: dict = {}
    g = FakeGemini()
    st = edit_items([item], cache, g, now=NOW, sleep=lambda s: None)
    assert st["edited"] == 1 and item["hook_title"] == "OpenAI가 더 싼 GPT-9 Mini를 내놨어요"
    again = dict(item, title_ko="GPT-9 Mini 공개")
    st2 = edit_items([again], cache, g, now=NOW, sleep=lambda s: None)
    assert st2["cached"] == 1 and g.calls == 1 and again["easy_summary_ko"].endswith("싸요.")
