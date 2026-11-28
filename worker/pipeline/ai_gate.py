"""AI 순도 게이트 — 종합 IT 소스(GeekNews·HN·V2EX·Juejin·Hatena·Qiita·Zenn 등)에서 AI 와 무관한 글을 걸러낸다.

web/edge/ai-gate.ts 와 같은 규칙:
1) 제목에 강한 AI 신호가 있으면 통과
2) 제목에 신호가 없는데 비AI 네거티브(디스크 정리·일반 보안 사건·하드웨어 등)가 보이면 탈락
3) 그 외에는 본문 앞부분에 서로 다른 AI 신호가 2개 이상이어야 통과 (한 번 스치듯 'AI' 만 언급한 글 차단)
"""

from __future__ import annotations

import re
from typing import Any, Mapping

_STRONG = (
    r"\bA\.?I\b", r"\bAGI\b", "artificial intelligence", r"\bLLMs?", r"\bGPT", "ChatGPT", "OpenAI", "Anthropic",
    "Claude", "Gemini", "DeepMind", r"\bCopilot", r"\bCodex\b", r"\bLlama\b", "Qwen", "DeepSeek", "Mistral", r"\bKimi\b",
    r"\bGLM-?\d", r"\bGrok\b", r"\bxAI\b", "Hugging ?Face", "Ollama", r"\bvLLM", r"\bMCP\b", r"\bagentic\b",
    r"\bAI[- ]?agents?\b", r"\bcoding agents?\b", r"\bRAG\b", "machine learning", "deep learning", "neural net", r"\btransformers?\b",
    "diffusion model", "Stable Diffusion", "Midjourney", r"\bSora\b", "fine-?tun", r"\bLoRA\b", r"\bembeddings?\b",
    "prompt (?:engineering|injection)", "system prompt", "multimodal", "chatbot", "foundation model", "language model", r"\bNLP\b",
    "computer vision", "reinforcement learning", r"\bRLHF\b", r"[A-Za-z]Attention\b", r"\bGGUF\b",
    r"\bDify\b", "LangChain", "LlamaIndex", "ComfyUI", "NotebookLM", "Perplexity", r"\bWindsurf\b",
    # 한국어
    "인공지능", "생성형", "에이전트", "챗봇", "챗GPT", "오픈AI", "앤트로픽", "앤스로픽", "클로드", "제미나이", "딥시크", "머신러닝", "딥러닝",
    "언어 ?모델", "파운데이션 모델", "신경망", "파인튜닝", "프롬프트", "멀티모달", "트랜스포머", "코파일럿",
    # 일본어
    "生成AI", "人工知能", "機械学習", "深層学習", "大規模言語モデル", "エージェント",
    # 중국어
    "人工智能", "大模型", "大语言模型", "智能体", "机器学习", "深度学习", "神经网络", "多模态", "提示词", "生成式", "AIGC", "推理模型",
)

# JS 의 \b 는 ASCII 단어 경계라서, 파이썬에서도 ASCII 모드로 맞춘다 (한글·한자 옆 'AI' 를 단어로 인식)
STRONG_RE = re.compile("(" + "|".join(_STRONG) + ")", re.I | re.A)

NON_AI_RE = re.compile(
    r"(磁盘清理|디스크\s?정리|disk\s?clean|cleaner\b|文件搜索|파일\s?검색|压缩\s?PNG|PNG\s?압축|戒手机|锁机|폰\s?중독|"
    r"랜섬웨어|ransomware|해킹\s?(?:그룹|조직|사건)|hacker\s?group|사이버\s?공격|cyber\s?-?attack|data\s?breach|개인정보\s?유출|정보\s?유출|"
    r"CVE-\d|zero-?day|제로데이|기계식\s?키보드|mechanical\s?keyboard|그래픽\s?카드\s?(?:가격|리뷰)|SSD\s?(?:가격|리뷰))",
    re.I | re.A,
)

# 종합 IT·커뮤니티 소스: 이 플랫폼 글만 게이트를 통과해야 실린다 (AI 전문 매체·공식 블로그는 면제)
GATED_PLATFORMS = frozenset({
    "geeknews", "hacker-news", "lobsters", "v2ex", "juejin", "zenn", "qiita", "hatena-bookmark", "pytorch-kr",
    "venturebeat-ai", "microsoft-research", "bluesky", "36kr-ai",
})


def is_ai_signal(title: str, body: str = "") -> bool:
    if STRONG_RE.search(title or ""):
        return True
    head = (body or "")[:600]
    if NON_AI_RE.search(f"{title} {head}"):
        return False
    hits = {m.group(0).lower() for m in STRONG_RE.finditer(head)}
    return len(hits) >= 2


def is_ai_candidate(platform_id: str, title: str, body: str = "") -> bool:
    """수집 후보(원문 제목·본문) 검사 — 게이트 대상 플랫폼만."""
    return platform_id not in GATED_PLATFORMS or is_ai_signal(title, body)


def is_ai_item(item: Mapping[str, Any]) -> bool:
    """이미 실린 스냅샷 아이템 재검사 (원문 제목 우선, 한국어 제목·요약은 본문 보조)."""
    if str(item.get("platform_id") or "") not in GATED_PLATFORMS:
        return True
    title = str(item.get("original_title") or item.get("title_ko") or "")
    body = f"{item.get('title_ko') or ''} {item.get('what_ko') or item.get('easy_summary_ko') or ''}"
    return is_ai_signal(title, body)


# Hugging Face 모델·스페이스 업로드 페이지 (개인 데모 앱·모델 파일 업로드 로그) — 속보가 아니라 피드에서 뺀다.
# 논문(/papers)·블로그·문서·데이터셋 안내는 유지 (web/edge/ai-gate.ts isHfUpload 와 동일)
_HF_UPLOAD_RE = re.compile(
    r"^https://huggingface\.co/(?!(?:papers|blog|docs|learn|datasets|collections|posts)/)(?:spaces/)?[^/?#]+/[^/?#]+/?$", re.I
)


def is_hf_upload(url: str) -> bool:
    return bool(_HF_UPLOAD_RE.match(url or ""))
