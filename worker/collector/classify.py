"""아이템 단위 카테고리 보정 (7종).

소스의 default_category 가 기본값이고, 제목·태그에 분명한 신호가 있을 때만 바꾼다.
  llm_chat     챗봇·생산성      dev        코딩·에이전트     image_design  이미지·디자인
  video_audio  영상·사운드      research   논문·신기술       industry      빅테크·트렌드
  social       커뮤니티·화제
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

VIDEO_AUDIO_RE = re.compile(
    r"\b(video|movie|film|animat\w*|audio|music|song|sound|voice|speech|tts|asr|sing\w*|podcast|dub\w*|"
    r"talking|lip.?sync|dance|text-to-video|image-to-video|text-to-speech|text-to-audio|audio-to-audio|"
    r"automatic-speech-recognition)\b",
    re.I,
)
IMAGE_RE = re.compile(
    r"\b(image|img|photo|picture|3d|mesh|avatar|anime|art|draw\w*|paint\w*|sketch|style|diffusion|flux|sdxl|"
    r"lora|face|portrait|upscal\w*|inpaint\w*|background|comic|cartoon|logo|design|illustrat\w*|"
    r"text-to-image|image-to-image|image-to-3d|text-to-3d)\b",
    re.I,
)
CHAT_RE = re.compile(
    r"\b(chat\w*|assistant|copilot|notebook\w*|productivity|search|perplexity|claude\.ai|gemini app|"
    r"conversational|text-generation|image-text-to-text)\b",
    re.I,
)
INDUSTRY_RE = re.compile(
    r"\b(ipo|initial public offering|funding|raises?|raised|series [a-f]|valuation|acquir\w*|acquisition|merger|"
    r"revenue|earnings|layoffs?|lawsuit|sues?|antitrust|regulat\w*|policy|ceo|partnership|partners with|"
    r"pricing|price|subscription|billion|million|market|stock|shares|investment|data ?cent(er|re)s?|chips?|"
    r"nvidia|government|congress|eu ai act|economy|economic|jobs?)\b",
    re.I,
)
RESEARCH_RE = re.compile(r"\b(paper|arxiv|study|researchers?|benchmark|dataset|theorem|physics|biology|science)\b", re.I)


def classify_hf_model(pipeline_tag: Optional[str], tags: Iterable[str]) -> str:
    text = " ".join([pipeline_tag or "", *tags])
    if VIDEO_AUDIO_RE.search(text):
        return "video_audio"
    if pipeline_tag in {"text-to-image", "image-to-image", "image-to-3d", "text-to-3d", "unconditional-image-generation"}:
        return "image_design"
    if pipeline_tag in {"text-generation", "image-text-to-text", "conversational"}:
        return "llm_chat"
    return "dev"


def classify_space(text: str) -> Optional[str]:
    """크리에이티브/챗 Space 만 남긴다. 해당 없으면 None (수집 제외)."""
    if VIDEO_AUDIO_RE.search(text):
        return "video_audio"
    if IMAGE_RE.search(text):
        return "image_design"
    if CHAT_RE.search(text):
        return "llm_chat"
    return None


def classify_news(title: str, default: str) -> str:
    """뉴스·커뮤니티 제목: 업계(돈·회사·정책) 신호 > 논문 신호 > 기본값."""
    if INDUSTRY_RE.search(title):
        return "industry"
    if default in {"dev", "social"} and RESEARCH_RE.search(title):
        return "research"
    return default
