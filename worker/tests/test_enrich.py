import struct
from datetime import datetime, timezone

import httpx

from pipeline.enrich import (
    assign_clusters,
    assign_images,
    conversational_paragraph,
    conversational_title,
    dimensions_ok,
    easy_summary,
    extract_og_image,
    github_preview,
    image_dimensions,
    is_plausible_image_url,
    vision_text,
)

NOW = datetime(2026, 11, 28, 9, 0, tzinfo=timezone.utc)


def test_conversational_endings():
    assert conversational_title("Zenn의 HTML 임베딩을 시도했습니다") == "Zenn의 HTML 임베딩을 시도했어요"
    assert conversational_title("참신한 RPG 룰북입니다") == "참신한 RPG 룰북이에요"
    assert conversational_title("ComfyUI v0.46.4 새 버전 공개") == "ComfyUI v0.46.4 새 버전 공개됐어요"
    assert conversational_title("AI가 무서워요") == "AI가 무서워요"
    assert conversational_title("왜 여기까지 할 수 있을까?") == "왜 여기까지 할 수 있을까?"
    assert "==" not in conversational_paragraph("==핵심은== 속도다. 보고서에 따르면, 비용이 줄었다.")
    assert conversational_paragraph("보고서에 따르면, 비용이 줄었다.") == "비용이 줄었어요."


def test_easy_summary_and_vision_are_conversational():
    item = {
        "hook_title": "새 모델 공개",
        "what_ko": "==OpenAI가== 더 빠른 모델을 내놓았다. 가격도 절반이다.",
        "why_ko": "개발자 비용이 줄어든다.",
        "planning_meta": {"signal_type": "model_release", "benchmark_point": "추론 비용 절감"},
        "entities": [{"name": "GPT-9 Mini", "kind": "model"}],
    }
    s = easy_summary(item)
    assert s.startswith("쉽게 말해") and "==" not in s and "요" in s
    v = vision_text(item)
    assert v.startswith("앞으로는") and "주목해 볼 수 있어요" in v and "GPT-9 Mini" in v


def test_image_helpers():
    assert github_preview("https://github.com/ollama/ollama/releases/tag/v1") == "https://opengraph.githubassets.com/1/ollama/ollama"
    assert not is_plausible_image_url("https://x.com/logo.png")
    assert not is_plausible_image_url("http://insecure.example.net/a.jpg")
    html = '<head><meta property="og:image" content="/img/hero.jpg"></head>'
    assert extract_og_image(html, "https://news.site.kr/a/1") == "https://news.site.kr/img/hero.jpg"
    png = b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + struct.pack(">II", 1, 1)
    assert image_dimensions(png) == (1, 1) and not dimensions_ok((1, 1))
    assert dimensions_ok((1200, 630)) and not dimensions_ok((1200, 100))


def test_assign_images_uses_og_and_cache():
    page = '<html><head><meta property="og:image" content="https://cdn.site.kr/photo.png"></head></html>'
    png = b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + struct.pack(">II", 1200, 630) + b"\0" * 4000

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/photo.png":
            return httpx.Response(200, headers={"content-type": "image/png"}, content=png)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=page)

    items = [
        {"canonical_url": "https://news.site.kr/a/1", "thumbnail_url": None},
        {"canonical_url": "https://github.com/a/b", "thumbnail_url": None},
        {"canonical_url": "https://x.com/u/status/1", "thumbnail_url": None},
    ]
    cache: dict = {}
    stats = assign_images(items, cache, now=NOW, client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    assert items[0]["image_url"] == "https://cdn.site.kr/photo.png"
    assert items[1]["image_url"].startswith("https://opengraph.githubassets.com/")
    assert items[2]["image_url"] is None
    assert stats["with_image"] == 2 and "https://news.site.kr/a/1" in cache


def test_clusters_link_same_story_across_outlets():
    base = {"published_at": "2026-11-28T01:00:00Z"}
    items = [
        {**base, "id": "a", "platform_id": "openai", "original_title": "Introducing Sora Studio video editor", "entities": [{"name": "Sora Studio"}]},
        {**base, "id": "b", "platform_id": "hacker-news", "original_title": "Sora Studio: OpenAI's new video editor", "entities": [{"name": "Sora Studio"}]},
        {**base, "id": "c", "platform_id": "zenn", "original_title": "Rust で書く CLI ツール", "entities": []},
    ]
    assert assign_clusters(items) == 1
    assert items[0]["cluster_size"] == 2 and items[0]["related_articles"][0]["id"] == "b"
    assert items[2]["cluster_size"] == 1 and items[2]["related_articles"] == []


def test_fallback_suffix_titles_stay_retranslatable():
    t = "LLM Agent , — 개발자 도구·오픈소스 공개됐어요"
    assert conversational_title(t).endswith("개발자 도구·오픈소스 공개")


def test_more_polite_endings():
    assert conversational_title("고유한 단백질 설계 기능을 보여줍니다") == "고유한 단백질 설계 기능을 보여줘요"
    assert conversational_title("조언에 말문이 막혔습니다") == "조언에 말문이 막혔어요"


def test_verb_i_and_vowel_harmony():
    assert conversational_title("OpenAI와 Cisco가 Shirudo를 선보입니다") == "OpenAI와 Cisco가 Shirudo를 선보여요"
    assert conversational_title("권한이 열렸던 시간은 남습니다") == "권한이 열렸던 시간은 남아요"
    assert conversational_title("코드를 먹습니다") == "코드를 먹어요"
def test_repairs_old_mistake():
    assert conversational_title("Shirudo를 선보예요") == "Shirudo를 선보여요"
