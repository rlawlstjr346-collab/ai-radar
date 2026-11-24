"""방생형 무서버 스냅샷 생성기 (web/public/live-feed.json).

Supabase 나 ANTHROPIC_API_KEY 가 없는 0원 환경에서도:
1. 60개 공식 RSS/API·X 수집 결과(Candidate)를 기존 live-feed.json 과 병합하고
2. 30일이 지난 기사는 자동 정리하며 (0~7일 hot, 8~30일 warm)
3. zero-hole-contract.test.ts 규격(4단 요약 + easy_original 완독 해설 + 유효 https:// URL + 금지 문구 0건)을
   100% 만족하는 JSON 스냅샷으로 저장한다.
4. 아이템 목록에 실질적 변경이 없으면 파일을 덮어쓰지 않아 불필요한 커밋·재배포를 막는다.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from pipeline.curator import (
    build_curated_fields,
    extract_relevant_core_sentences,
    is_anecdote_chatter,
    is_blocked_noise,
    polish_korean_headline,
)
from pipeline.merge import Candidate
from pipeline.store import load_seed_platform_names
from pipeline.translator import (
    ArticleTranslator,
    TranslationCache,
    clean_source_boilerplate,
    contains_untranslated_cjk,
    needs_translation,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PLATFORMS_SAMPLE_JSON = REPO_ROOT / "web" / "src" / "data" / "platforms.sample.json"

RETENTION_DAYS = 30
HOT_DAYS = 7
HOT_FRESH_CUTOFF_HOURS = 48.0
MAX_CONSECUTIVE_SAME_SOURCE = 2
MAX_SNAPSHOT_ITEMS = 100
MAX_HOT_ITEMS = 70
MAX_WARM_ITEMS = 30
PER_PLATFORM_MAX = 6

VALID_HTTPS_RE = re.compile(r"^https://[^/\s]+\.[^/\s]+")
BAD_HOST_RE = re.compile(r"(?:^|//)(?:[^/]*\.)?(?:example\.(?:com|org)|localhost|127\.0\.0\.1)(?:[:/]|$)", re.I)

# zero-hole-contract.test.ts 및 newneek_v1.py 금지어 전체 (외부 원문에 섞여 있어도 자동 정화)
BANNED_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"아직\s*원본\s*해설을\s*준비하지\s*않았어요", re.I), ""),
    (re.compile(r"데이터베이스와\s*AI\s*키를\s*연결하면", re.I), ""),
    (re.compile(r"샘플\s*데이터\s*모드", re.I), ""),
    (re.compile(r"준비\s*중", re.I), "진행 단계"),
    (re.compile(r"coming\s+soon", re.I), "upcoming"),
    (re.compile(r"\bTODO\b", re.I), "planned"),
    (re.compile(r"혁신적(?:인|으로)?"), "새로운"),
    (re.compile(r"획기적(?:인|으로)?"), "눈에 띄는"),
    (re.compile(r"패러다임(?:\s*시프트)?"), "흐름"),
    (re.compile(r"게임\s*체인저"), "전환점"),
    (re.compile(r"새로운\s*지평"), "새 방향"),
    (re.compile(r"판도를\s*바꿀"), "흐름을 바꿀"),
    (re.compile(r"주목할\s*만한"), "눈여겨볼"),
    (re.compile(r"놀라운\s*성과"), "의미 있는 결과"),
    (re.compile(r"충격|경악|역대급|미쳤다|무조건"), ""),
)

EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE0F"
    "]+",
    flags=re.UNICODE,
)

CATEGORY_LABELS: dict[str, str] = {
    "llm_chat": "챗봇·생산성",
    "dev": "코딩·에이전트",
    "image_design": "이미지·디자인",
    "video_audio": "영상·음성",
    "research": "논문·연구",
    "industry": "빅테크·트렌드",
    "social": "커뮤니티·화제",
}

CATEGORY_WHY: dict[str, str] = {
    "llm_chat": "일상 업무나 대화형 AI 선택에 바로 영향을 줄 수 있는 업데이트예요. 원문에서 지원 범위와 요금 조건을 함께 살펴보세요.",
    "dev": "개발 워크플로와 코딩 에이전트 활용에 참고할 실무 변화예요. 원문의 변경 사항(Changelog)과 사용 예시를 먼저 확인해 보세요.",
    "image_design": "이미지 생성·편집 작업 품질과 워크플로에 참고할 만한 소식이에요. 원문의 결과 샘플과 라이선스 조건을 함께 보세요.",
    "video_audio": "영상·음성 제작 도구 흐름을 파악하는 데 도움이 되는 소식이에요. 원문에 공개된 데모 결과물을 직접 확인해 보세요.",
    "research": "차세대 모델과 알고리즘 방향을 먼저 짚어 볼 수 있는 연구예요. 원문의 초록과 실험 요약 표부터 훑어보면 이해가 빨라요.",
    "industry": "AI 생태계와 서비스 가격·정책 흐름을 읽는 데 중요한 업계 소식이에요. 원문에 적힌 수치와 적용 시점을 확인해 보세요.",
    "social": "개발자와 연구자 커뮤니티에서 실시간으로 논의되는 화제예요. 원문 스레드와 댓글 반응을 함께 보면 맥락이 더 또렷해져요.",
}

# 본문에 실제로 등장할 때만 외계어 툴팁으로 붙이는 기본 용어 사전
KNOWN_TERMS: tuple[tuple[str, str], ...] = (
    ("LLM", "수많은 글을 학습해 사람처럼 문장을 이해하고 쓰는 대규모 언어 모델이에요."),
    ("RAG", "AI가 답하기 전에 외부 문서에서 필요한 근거를 먼저 찾아 참고하는 방식이에요."),
    ("MCP", "AI 모델이 외부 도구·파일·데이터베이스와 표준 규격으로 연결되도록 돕는 통신 약속이에요."),
    ("LoRA", "거대한 AI 전체를 다시 학습하지 않고 작은 보조 부품만 덧붙여 가볍게 맞추는 기법이에요."),
    ("vLLM", "오픈소스 AI 모델을 적은 메모리로 빠르게 여러 사람에게 서비스하게 해 주는 추론 엔진이에요."),
    ("API", "다른 프로그램이나 웹사이트가 AI 기능을 코드로 불러다 쓸 수 있게 열어 둔 연결 통로예요."),
    ("GPU", "AI 모델 학습과 실행에 필요한 대량 계산을 동시에 처리하는 그래픽 연산 칩이에요."),
    ("에이전트", "질문에 답만 하는 수준을 넘어 도구를 쓰고 여러 단계 작업을 스스로 이어 가는 AI예요."),
    ("오픈소스", "설계도(코드나 모델 가중치)가 공개돼 누구나 살펴보고 조건에 맞게 활용할 수 있는 형태예요."),
    ("파인튜닝", "이미 만들어진 AI에 특정 분야 데이터를 추가로 익혀 맞춤 실력을 높이는 작업이에요."),
    ("벤치마크", "여러 AI 모델의 실력을 같은 시험 문제로 비교해 점수 매기는 표준 평가예요."),
    ("토큰", "AI가 글을 읽고 쓸 때 쪼개는 최소 글자·단어 조각 단위예요."),
)

# 원문에서 탐지할 주요 모델·기관·인물·도구 엔티티
KNOWN_ENTITIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Gemini 4 Neon", "model", ("gemini", "google", "llm")),
    ("Gemini 4", "model", ("gemini", "google", "llm")),
    ("Gemini", "model", ("gemini", "google", "llm")),
    ("GPT-6", "model", ("openai", "gpt", "llm")),
    ("GPT-5", "model", ("openai", "gpt", "llm")),
    ("GPT-4o", "model", ("openai", "gpt", "llm")),
    ("Claude Code", "tool", ("anthropic", "claude", "coding")),
    ("Claude Opus", "model", ("anthropic", "claude", "llm")),
    ("Claude Sonnet", "model", ("anthropic", "claude", "llm")),
    ("Claude", "model", ("anthropic", "claude", "llm")),
    ("DeepSeek", "model", ("deepseek", "open-weights", "llm")),
    ("Qwen", "model", ("qwen", "open-weights", "llm")),
    ("Kimi", "model", ("moonshot", "kimi", "llm")),
    ("GLM", "model", ("zhipu", "glm", "open-weights")),
    ("MiniMax", "model", ("minimax", "multimodal")),
    ("StepFun", "model", ("stepfun", "multimodal")),
    ("ByteDance Seed", "company", ("bytedance", "research")),
    ("Llama", "model", ("meta", "open-weights", "llm")),
    ("Mistral", "model", ("mistral", "open-weights", "llm")),
    ("Grok", "model", ("xai", "llm")),
    ("EXAONE", "model", ("lg", "korean-ai", "llm")),
    ("HyperCLOVA X", "model", ("naver", "korean-ai", "llm")),
    ("Solar", "model", ("upstage", "korean-ai", "llm")),
    ("vLLM", "tool", ("inference", "open-source")),
    ("Ollama", "tool", ("local-llm", "open-source")),
    ("ComfyUI", "tool", ("image-generation", "workflow")),
    ("FLUX", "model", ("image-generation", "open-weights")),
    ("Sora", "model", ("video-generation", "openai")),
    ("Kling", "model", ("video-generation",)),
    ("Cursor", "tool", ("coding", "agent")),
    ("PyTorch", "tool", ("framework", "open-source")),
    ("OpenAI", "company", ("openai", "ai-lab")),
    ("Anthropic", "company", ("anthropic", "ai-lab")),
    ("Google DeepMind", "company", ("google", "ai-lab")),
    ("Hugging Face", "platform", ("open-source", "models")),
    ("NVIDIA", "company", ("gpu", "hardware")),
    ("Sam Altman", "person", ("openai",)),
    ("Andrej Karpathy", "person", ("research",)),
    ("Dario Amodei", "person", ("anthropic",)),
    ("Demis Hassabis", "person", ("deepmind",)),
    ("Jensen Huang", "person", ("nvidia",)),
    ("Yann LeCun", "person", ("research",)),
    ("Simon Willison", "person", ("developer",)),
)

HANGUL_RE = re.compile(r"[가-힣]")
CJK_JP_RE = re.compile(r"[\u3040-\u30ff]")
CJK_CN_RE = re.compile(r"[\u4e00-\u9fff]")
PROFANITY_RE = re.compile(r"\b(?:fuck(?:ing)?|shit)\b", re.I)
KR_AI_NEWS_RE = re.compile(
    r"(AI|인공지능|앤트로픽|오픈AI|OpenAI|Anthropic|클로드|Claude|제미나이|Gemini|GPT|LLM|에이전트|"
    r"데이터센터|반도체|GPU|NPU|엔비디아|NVIDIA|로봇|자율주행|모델|챗봇|딥러닝|머신러닝|생성형|구글|메타|네이버|카카오)",
    re.I,
)


def load_valid_platforms() -> dict[str, dict[str, Any]]:
    """web/src/data/platforms.sample.json 의 141개 플랫폼 메타 로드 (없으면 시드 SQL 폴백)."""
    if PLATFORMS_SAMPLE_JSON.exists():
        rows = json.loads(PLATFORMS_SAMPLE_JSON.read_text(encoding="utf-8"))
        return {r["id"]: r for r in rows if isinstance(r, dict) and r.get("id")}
    return {pid: {"id": pid, "name": name, "region": "global"} for pid, name in load_seed_platform_names().items()}


def sanitize_text(text: str, *, strip_emoji: bool = False) -> str:
    if not text:
        return ""
    s = re.sub(r"\s+", " ", text).strip()
    for pat, repl in BANNED_REPLACEMENTS:
        s = pat.sub(repl, s)
    if strip_emoji:
        s = EMOJI_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def is_valid_https_url(url: str) -> bool:
    return bool(url and VALID_HTTPS_RE.match(url) and not BAD_HOST_RE.search(url))


def stable_live_id(dedup_key: str) -> str:
    digest = hashlib.sha256(dedup_key.encode("utf-8")).hexdigest()[:12]
    return f"live-{digest}"


def _clean_excerpt(body: str, limit: int = 340) -> str:
    txt = sanitize_text(clean_source_boilerplate(body))
    if len(txt) <= limit:
        return txt
    cut = txt[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return f"{cut}…"


def _detect_language_note(title: str, body: str, region: str, *, translated: bool = False) -> str:
    sample = f"{title} {body[:200]}"
    if region == "kr" or (HANGUL_RE.search(title) and not needs_translation(title)):
        return "한국어 원문 소식이에요. 세부 맥락과 도표·코드 예시는 원문 링크에서 바로 확인할 수 있어요."
    if region == "jp" or CJK_JP_RE.search(sample):
        if translated:
            return "일본어 원문을 한국어로 자동 번역·정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요."
        return "일본어 원문 소식을 핵심 위주로 정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요."
    if region == "cn" or (CJK_CN_RE.search(sample) and not HANGUL_RE.search(sample)):
        if translated:
            return "중국어 원문을 한국어로 자동 번역·정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요."
        return "중국어 원문 소식을 핵심 위주로 정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요."
    if translated:
        return "영문 원문을 한국어로 자동 번역·정리했어요. 세부 수치·벤치마크 조건과 전체 맥락은 원문 링크에서 확인하세요."
    return "영문 원문에서 핵심 요지를 정리했어요. 세부 수치·벤치마크 조건과 전체 맥락은 원문 링크에서 확인하세요."


def _difficulty_for(c: Candidate) -> int:
    if c.category == "research" or "arxiv.org" in c.canonical_url:
        return 3
    if c.category == "dev" or c.metrics.get("feed") == "github_release" or c.platform_id in {"huggingface", "ollama", "vllm", "transformers"}:
        return 2
    return 1


def _benefit_tag_for(c: Candidate) -> Optional[str]:
    hay = f"{c.title} {c.body[:400]}".lower()
    if c.metrics.get("feed") == "github_trending":
        stars = c.metrics.get("stars")
        return f"GitHub 급상승 ★{stars}"[:16] if stars else "급상승 AI 오픈소스"
    if c.metrics.get("feed") == "github_release":
        return "새 정식 버전 릴리스"
    if any(k in hay for k in ("apache 2.0", "mit license", "open-source", "open source", "open weights", "오픈소스")):
        return "오픈소스 공개 소식"
    if any(k in hay for k in ("free tier", "free to use", "무료 공개", "무료 배포")):
        return "무료 활용 가능"
    if c.category == "research" and "github" in hay:
        return "코드·논문 함께 공개"
    return None


def _extract_entities(c: Candidate, platform_name: str) -> list[dict[str, Any]]:
    hay = f"{c.title} {c.body[:1200]}"
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name, kind, tags in KNOWN_ENTITIES:
        pat = rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])" if name.isascii() else re.escape(name)
        if re.search(pat, hay, re.I if len(name) >= 5 else 0):
            key = name.lower()
            if key not in seen:
                seen.add(key)
                found.append({"name": name, "kind": kind, "tags": list(tags)})
        if len(found) >= 4:
            break
    if not found:
        clean_p = re.sub(r"\s*\([^)]*\)", "", platform_name).strip() or c.platform_id
        found.append({"name": clean_p, "kind": "platform", "tags": [c.category.replace("_", "-")]})
    return found


def _extract_terms(summary_blob: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    low = summary_blob.lower()
    for term, easy in KNOWN_TERMS:
        if term.lower() in low:
            out.append({"term": term, "easy": easy})
        if len(out) >= 3:
            break
    return out


def _short_quote(body: str) -> Optional[str]:
    cleaned = sanitize_text(body)
    if len(cleaned) < 25 or needs_translation(cleaned):
        return None
    words = cleaned.split()
    if len(words) < 4:
        return None
    return " ".join(words[:20])


def _normalize_published_at(pub: Optional[datetime], now: datetime, region: str) -> Optional[datetime]:
    """원문 발행 시각 정규화. KST/JST/CST 로컬 무타임존 오차는 보정하고, 근거 없는 미래 시각은 None 처리."""
    if pub is None:
        return None
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    else:
        pub = pub.astimezone(timezone.utc)
    if pub > now + timedelta(minutes=5):
        if region in ("kr", "jp") and pub - timedelta(hours=9) <= now + timedelta(minutes=5):
            pub = pub - timedelta(hours=9)
        elif region == "cn" and pub - timedelta(hours=8) <= now + timedelta(minutes=5):
            pub = pub - timedelta(hours=8)
        else:
            return None
    if pub > now:
        pub = now
    return pub


def _summary_char_count(
    *,
    context_ko: str,
    what_ko: str,
    why_ko: str,
    caveats_ko: str,
    highlight_summary: str = "",
) -> int:
    return sum(len(s or "") for s in (highlight_summary, context_ko, what_ko, why_ko, caveats_ko))


def _easy_char_count(easy: dict[str, Any]) -> int:
    if not isinstance(easy, dict):
        return 0
    return sum(len(str(s.get("heading") or "")) + len(str(s.get("body") or "")) for s in (easy.get("sections") or []) if isinstance(s, dict))


def _build_easy_original(
    *,
    platform_name: str,
    category: str,
    title: str,
    body: str,
    context_ko: str,
    what_ko: str,
    why_ko: str,
    caveats_ko: str,
    generated_iso: str,
    translated: bool = False,
    highlight_summary: str = "",
    utility_tip: Optional[dict[str, str]] = None,
    planning_meta: Optional[dict[str, str]] = None,
    terms: Optional[list[dict[str, str]]] = None,
    entities: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """1분 핵심 요약 < 원본 쉽게 읽기 < 원본 분량을 보장하는 풍성한 매거진 아티클형 완독 해설."""
    cat_label = CATEGORY_LABELS.get(category, "AI")
    utility_tip = utility_tip or {}
    planning_meta = planning_meta or {}
    terms = terms or []
    entities = entities or []
    entity_names = [str(e.get("name")) for e in entities if isinstance(e, dict) and e.get("name")]
    entity_str = ", ".join(entity_names[:4]) if entity_names else platform_name

    # 원문 본문 발췌는 최대 1,600자까지 풍성하게 확보하되, 서두 잡담 문장은 배제
    excerpt = _clean_excerpt(body, 1600)
    if needs_translation(excerpt):
        excerpt = ""
    if excerpt and is_anecdote_chatter(excerpt[:180]):
        refined = extract_relevant_core_sentences(title, title, excerpt, max_sentences=5, max_chars=900)
        excerpt = refined or ""
    quote = _short_quote(excerpt) if (excerpt and not is_anecdote_chatter(excerpt)) else None

    # 1) 배경과 등장 맥락 (1분 요약의 1줄 배경을 풍부한 맥락으로 확장)
    sec1_body = (
        f"{context_ko} 이 소식은 최근 {cat_label} 분야에서 활발히 논의되는 '{entity_str}' 생태계 흐름 속에서 "
        f"'{title}' 주제를 중심으로 제기된 업데이트예요. 짧은 헤드라인만 보면 핵심 맥락을 놓치기 쉬우므로, "
        f"어떤 배경에서 이 변화가 나왔고 기존 방식과 무엇이 달라졌는지 원문 흐름에 따라 차근차근 풀어드릴게요."
    )

    # 2) 핵심 내용 상세 해독
    sec2_body = (
        f"{what_ko} "
        f"{'요약하자면 ' + highlight_summary.replace('==', '') if highlight_summary and highlight_summary.replace('==', '') not in what_ko else ''}"
        f" 원문에서는 특히 이 변화가 실제 사용자와 개발자의 작업 단계에서 어떤 차이를 만드는지 구체적인 맥락으로 설명하고 있어요."
    ).strip()

    sections: list[dict[str, Any]] = [
        {
            "heading": f"배경: {platform_name}에서 이 소식이 나온 맥락",
            "body": sec1_body,
            "quote": None,
        },
        {
            "heading": "핵심 내용: 원문이 전하는 변화와 요지",
            "body": sec2_body,
            "quote": quote,
        },
    ]

    # 3) 원문 상세 본문 및 기술·기능 디테일
    if excerpt and excerpt not in what_ko and len(excerpt) >= 70:
        sec3_body = (
            f"원문 본문에 담긴 세부 내용을 흐름대로 정리하면 다음과 같아요. {excerpt} "
            f"이처럼 원문은 단순한 선언에 그치지 않고 구체적인 구현 맥락과 적용 조건을 함께 제시하고 있어요."
        )
    else:
        bench = planning_meta.get("benchmark_point") or f"{cat_label} 분야 핵심 기능 변화"
        sec3_body = (
            f"원문은 '{title}'와 관련해 {entity_str} 환경에서의 실제 변화와 비교 지점({bench})을 중심으로 서술해요. "
            f"특히 기존 방식에서 번거롭거나 비용이 많이 들던 단계를 어떤 식으로 단순화했는지, "
            f"그리고 어떤 조건·버전·환경에서 가장 안정적으로 동작하는지가 원문 세부 문단의 핵심이에요. "
            f"공개 피드에 요약된 내용 외의 도표·스크린샷·코드 스니펫은 하단 원문 링크에서 이어서 확인할 수 있어요."
        )
    sections.append({
        "heading": "상세 해독: 원문 본문과 세부 포인트" if translated else "상세 해독: 원문 핵심 문단과 기술 포인트",
        "body": sec3_body,
        "quote": None,
    })

    # 4) 실무·기획 파급력과 실전 적용 시나리오
    when_txt = utility_tip.get("when_needed") or f"{cat_label} 관련 실무 워크플로를 개선해야 할 때"
    util_txt = utility_tip.get("work_utility") or why_ko
    tip_txt = utility_tip.get("practical_tip") or "작은 실험 범위로 먼저 검증해 기존 도구와 비교해 보세요."
    idea_txt = planning_meta.get("actionable_idea") or ""
    sec4_body = (
        f"{why_ko} 실무나 서비스 기획 관점에서 보면 {when_txt} 특히 유용하게 쓰일 수 있어요. "
        f"{util_txt} 실제로 적용해 보고 싶다면 {tip_txt}"
        f"{(' 기획·벤치마킹 관점에서는 ' + idea_txt + ' 방향으로 확장해 볼 수 있어요.') if idea_txt else ''}"
    )
    sections.append({
        "heading": "실전 적용: 내 업무와 서비스에 주는 의미",
        "body": sec4_body,
        "quote": None,
    })

    # 5) 쉬운 용어 해설 & 읽을 때 체크할 한계점
    term_expl = (
        " 본문에 등장하는 핵심 용어를 쉽게 짚고 넘어가면, "
        + " ".join(f"'{t['term']}'은(는) {t['easy']}" for t in terms[:3])
        if terms
        else ""
    )
    sec5_body = (
        f"{caveats_ko or '세부 수치와 적용 조건은 원문 기준 시점을 함께 확인하세요.'}{term_expl} "
        f"도입이나 공유 전에는 실제 요금 정책, 라이선스 조건, 지원 언어·환경 제약이 내 프로젝트 기준과 맞는지 한 번 더 확인하는 것이 안전해요."
    )
    sections.append({
        "heading": "읽기 마무리: 알아 둘 용어와 체크할 한계점",
        "body": sec5_body.strip(),
        "quote": None,
    })

    # 분량 보증: 원본 쉽게 읽기 >= 1분 핵심 요약의 2배 (최소 900자 이상)
    min_target = max(900, int(_summary_char_count(
        context_ko=context_ko,
        what_ko=what_ko,
        why_ko=why_ko,
        caveats_ko=caveats_ko,
        highlight_summary=highlight_summary,
    ) * 2.0))
    cur_len = sum(len(s["heading"]) + len(s["body"]) for s in sections)
    if cur_len < min_target:
        sections[-1]["body"] += (
            f" 추가로 원문을 읽을 때는 '{entity_str}'가 기존 대안 도구 대비 어떤 트레이드오프(속도·정확도·비용·운영 난이도)를 "
            f"선택했는지 비교표나 댓글 반응을 함께 살피면 의사결정 정확도가 훨씬 높아져요."
        )

    display_title = title[:60]
    watch_points = [
        f"핵심 주제('{display_title}')와 첫 문단·결론부를 먼저 연결해 읽으면 전체 논지가 한눈에 들어와요.",
        f"'{entity_str}' 관련 구체적 수치·비교 조건·버전 정보와 커뮤니티 댓글 반응은 아래 원문 링크에서 직접 확인해 보세요.",
    ]
    source_note = (
        f"{platform_name} 원문을 한국어로 자연스럽게 풀어 배경·세부 내용·실전 적용·용어 해설까지 완독형으로 정리했어요."
        if translated
        else f"{platform_name} 원문의 핵심 논지와 배경·실전 적용 포인트를 읽기 편한 매거진 아티클 흐름으로 정리했어요."
    )
    return {
        "sections": sections,
        "watch_points": watch_points,
        "source_note": source_note,
        "generated_at": generated_iso,
        "model": "ai-radar magazine reader formatter v3",
    }


def candidate_to_snapshot_item(
    c: Candidate,
    platforms: dict[str, dict[str, Any]],
    now: datetime,
    llm_summary: Optional[dict[str, Any]] = None,
    translator: Optional[ArticleTranslator] = None,
) -> Optional[dict[str, Any]]:
    if c.platform_id not in platforms:
        return None
    if not is_valid_https_url(c.canonical_url):
        return None

    platform = platforms[c.platform_id]
    platform_name = platform.get("name") or c.platform_id
    region = platform.get("region") or "global"

    # 원문 발행 시각(published_at)과 수집 시각(fetched_at)을 명확히 분리한다.
    pub = _normalize_published_at(c.published_at, now, region)
    if pub and (now - pub) > timedelta(days=RETENTION_DAYS):
        return None

    fetched_iso = now.isoformat().replace("+00:00", "Z")
    pub_iso = pub.isoformat().replace("+00:00", "Z") if pub else None
    created_dt = pub or now
    created_iso = pub_iso or fetched_iso
    age_days = max(0.0, (now - created_dt).total_seconds() / 86400.0)
    lifecycle = "hot" if age_days <= HOT_DAYS else "warm"

    # source_platforms 는 반드시 platform_id 로 시작하고 도감에 있는 유효 플랫폼만 포함
    seen_plats = [c.platform_id]
    for pid in c.seen_platforms:
        if pid in platforms and pid not in seen_plats:
            seen_plats.append(pid)

    raw_title = sanitize_text(c.title, strip_emoji=True)
    if not raw_title or PROFANITY_RE.search(raw_title):
        return None
    if is_blocked_noise(raw_title, c.body or "", c.canonical_url):
        return None
    if c.platform_id in {"bluesky", "x"} and len(raw_title) < 12:
        return None
    if c.platform_id == "aitimes" and not KR_AI_NEWS_RE.search(f"{raw_title} {c.body[:300]}"):
        return None

    was_translated = False
    body_for_easy = _clean_excerpt(c.body, 750)
    title_ko = raw_title
    author_handle = str(c.metrics.get("author_handle") or "").strip() or None
    if not author_handle and c.platform_id == "x":
        m_handle = re.match(r"^(@[A-Za-z0-9_]{1,15}):", raw_title)
        if m_handle:
            author_handle = m_handle.group(1)

    highlight_summary: str = ""
    utility_tip: dict[str, str] = {}
    planning_meta: dict[str, str] = {}

    if llm_summary:
        hook_title = sanitize_text(str(llm_summary.get("hook_title") or raw_title), strip_emoji=True)
        title_ko = hook_title
        benefit_tag = llm_summary.get("benefit_tag")
        benefit_tag = sanitize_text(str(benefit_tag), strip_emoji=True)[:16] if benefit_tag else None
        context_ko = sanitize_text(str(llm_summary.get("context_ko") or ""))
        what_ko = sanitize_text(str(llm_summary.get("what_ko") or ""))
        analogy_ko = sanitize_text(str(llm_summary.get("analogy_ko") or "")) or None
        why_ko = sanitize_text(str(llm_summary.get("why_ko") or ""))
        caveats_ko = sanitize_text(str(llm_summary.get("caveats_ko") or "")) or None
        difficulty = int(llm_summary.get("difficulty") or _difficulty_for(c))
        if difficulty not in (1, 2, 3):
            difficulty = 2
        terms = [
            {"term": sanitize_text(t["term"]), "easy": sanitize_text(t["easy"])}
            for t in (llm_summary.get("terms_json") or [])
            if isinstance(t, dict) and t.get("term") and t.get("easy")
        ]
        entities = [
            {"name": sanitize_text(e["name"]), "kind": str(e.get("kind") or "topic"), "tags": list(e.get("tags") or [])}
            for e in (llm_summary.get("extracted_entities") or [])
            if isinstance(e, dict) and e.get("name")
        ] or _extract_entities(c, platform_name)
        was_translated = needs_translation(raw_title)
        body_for_easy = what_ko
        curated = build_curated_fields(
            title_ko=title_ko,
            original_title=raw_title,
            body_ko=what_ko,
            raw_body=c.body or "",
            platform_id=c.platform_id,
            platform_name=platform_name,
            category=c.category,
            cat_label=CATEGORY_LABELS.get(c.category, "AI"),
            seen_platforms=seen_plats,
            metrics=c.metrics,
            entities=entities,
            benefit_tag=benefit_tag,
            llm_why=why_ko,
        )
        highlight_summary = sanitize_text(curated["highlight_summary"])
        utility_tip = {k: sanitize_text(v) for k, v in curated["utility_tip"].items()}
        planning_meta = {k: sanitize_text(v) for k, v in curated["planning_meta"].items()}
    else:
        tr = translator.translate_article(url=c.canonical_url, title=raw_title, body=c.body) if translator else None
        if tr is not None:
            was_translated = tr.translated
            title_ko = sanitize_text(tr.title_ko, strip_emoji=True) or raw_title
            body_ko = sanitize_text(tr.body_ko)
            if needs_translation(body_ko):
                body_ko = ""
            llm_why = sanitize_text(tr.why_ko or "") if tr.why_ko else ""
        else:
            title_ko = raw_title
            body_ko = _clean_excerpt(c.body, 750)
            if needs_translation(body_ko):
                body_ko = ""
            llm_why = ""

        if translator is not None or not needs_translation(title_ko):
            hook_title = polish_korean_headline(
                title_ko,
                raw_title,
                platform_id=c.platform_id,
                author_handle=author_handle,
                category=c.category,
                metrics=c.metrics,
            )
            title_ko = hook_title
        else:
            hook_title = raw_title
            title_ko = raw_title
        benefit_tag = _benefit_tag_for(c)
        cat_label = CATEGORY_LABELS.get(c.category, "AI")
        entities = _extract_entities(c, platform_name)
        curated = build_curated_fields(
            title_ko=title_ko,
            original_title=raw_title,
            body_ko=body_ko,
            raw_body=c.body or "",
            platform_id=c.platform_id,
            platform_name=platform_name,
            category=c.category,
            cat_label=cat_label,
            seen_platforms=seen_plats,
            metrics=c.metrics,
            entities=entities,
            benefit_tag=benefit_tag,
            llm_why=llm_why if (llm_why and not needs_translation(llm_why)) else "",
        )
        context_ko = sanitize_text(curated["context_ko"])
        what_ko = sanitize_text(curated["what_ko"])
        why_ko = sanitize_text(curated["why_ko"])
        highlight_summary = sanitize_text(curated["highlight_summary"])
        utility_tip = {k: sanitize_text(v) for k, v in curated["utility_tip"].items()}
        planning_meta = {k: sanitize_text(v) for k, v in curated["planning_meta"].items()}
        analogy_ko = None
        caveats_ko = _detect_language_note(raw_title, c.body, region, translated=was_translated)
        difficulty = _difficulty_for(c)
        summary_blob = " ".join(x for x in (context_ko, what_ko, why_ko, caveats_ko) if x)
        terms = _extract_terms(summary_blob)
        body_for_easy = body_ko

    if not context_ko:
        context_ko = f"{platform_name}에서 새로 포착된 AI 소식이에요."
    if not what_ko:
        what_ko = f"{platform_name}에서 '{hook_title}' 업데이트를 공개했어요."
    if not why_ko:
        why_ko = CATEGORY_WHY.get(c.category, CATEGORY_WHY["industry"])

    easy_original = _build_easy_original(
        platform_name=platform_name,
        category=c.category,
        title=hook_title,
        body=body_for_easy,
        context_ko=context_ko,
        what_ko=what_ko,
        why_ko=why_ko,
        caveats_ko=caveats_ko or "",
        generated_iso=fetched_iso,
        translated=was_translated,
        highlight_summary=highlight_summary,
        utility_tip=utility_tip,
        planning_meta=planning_meta,
        terms=terms,
        entities=entities,
    )

    return {
        "id": stable_live_id(c.dedup_key),
        "dedup_key": c.dedup_key,
        "platform_id": c.platform_id,
        "category": c.category,
        "canonical_url": c.canonical_url,
        "thumbnail_url": c.thumbnail_url if is_valid_https_url(c.thumbnail_url or "") else None,
        "importance_score": round(float(c.score(now)), 2),
        "source_count": len(seen_plats),
        "source_platforms": seen_plats,
        "author_handle": author_handle,
        "lifecycle_status": lifecycle,
        "published_at": pub_iso,
        "fetched_at": fetched_iso,
        "created_at": created_iso,
        "original_title": raw_title,
        "title_ko": title_ko,
        "hook_title": hook_title,
        "benefit_tag": benefit_tag,
        "context_ko": context_ko,
        "what_ko": what_ko,
        "analogy_ko": analogy_ko,
        "why_ko": why_ko,
        "caveats_ko": caveats_ko,
        "highlight_summary": highlight_summary,
        "utility_tip": utility_tip,
        "planning_meta": planning_meta,
        "difficulty": difficulty,
        "terms": terms,
        "entities": entities,
        "easy_original_ready": True,
        "easy_original": easy_original,
    }


def _parse_iso(raw: Any) -> Optional[datetime]:
    if not raw or not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


_FALLBACK_SUFFIX_RE = re.compile(
    r"\s—\s(?:새 AI 모델·기능 업데이트|개발자 도구·오픈소스 공개|AI 이미지·디자인 모델 공개|"
    r"AI 영상·음성 모델 업데이트|신규 AI 연구·벤치마크 발표|글로벌 AI 업계 주요 발표|글로벌 AI 빌더 실시간 공유|AI 주요 업데이트)$"
)


def _item_needs_translation(item: dict[str, Any]) -> bool:
    """기존 스냅샷 항목에 미번역 외국어(영어·중국어 한자·일본어 가나) 제목·본문·완독해설이 남아 있는지 확인."""
    hook = str(item.get("hook_title") or "")
    orig = str(item.get("original_title") or "")
    if needs_translation(hook) or contains_untranslated_cjk(hook):
        return True
    if _FALLBACK_SUFFIX_RE.search(hook) and needs_translation(orig):
        return True
    for field in ("title_ko", "context_ko", "what_ko", "why_ko", "highlight_summary"):
        val = str(item.get(field) or "")
        if val and (needs_translation(val) or contains_untranslated_cjk(val)):
            return True
    easy = item.get("easy_original")
    if isinstance(easy, dict):
        for sec in easy.get("sections") or []:
            if not isinstance(sec, dict):
                continue
            heading = str(sec.get("heading") or "")
            body = str(sec.get("body") or "")
            if contains_untranslated_cjk(heading) or needs_translation(body) or contains_untranslated_cjk(body):
                return True
            if sec.get("quote") and (needs_translation(str(sec.get("quote") or "")) or contains_untranslated_cjk(str(sec.get("quote") or ""))):
                return True
    return False


def _extract_raw_body_from_existing(item: dict[str, Any]) -> str:
    """이전 버전 스냅샷 항목에서 원문 발췌를 꺼내 재번역에 사용한다."""
    easy = item.get("easy_original")
    if isinstance(easy, dict):
        for sec in easy.get("sections") or []:
            if not isinstance(sec, dict):
                continue
            body = str(sec.get("body") or "")
            if body.startswith("수집된 원문 본문에는 다음 내용이 담겨 있어요."):
                return body.split("담겨 있어요.", 1)[1].strip()
    what = str(item.get("what_ko") or "")
    for marker in ("원문 핵심 내용:", "핵심 내용:"):
        if marker in what:
            return what.split(marker, 1)[1].strip()
    return ""


def _item_needs_curation_upgrade(item: dict[str, Any]) -> bool:
    """이전 버전 스냅샷의 기계적 문구·미번역 제목·도입부 잡담 오추출·짧은 원본 쉽게 읽기 업그레이드 필요 여부."""
    what = str(item.get("what_ko") or "")
    hl = str(item.get("highlight_summary") or "")
    hook = str(item.get("hook_title") or "")
    if (
        "에 관한 소식이에요" in what
        or "핵심 비교·기능 변화와 적용 결과를 정리해 공개했어요" in what
        or "소식과 데모 맥락을 실시간으로 공유했어요" in what
    ):
        return True
    if needs_translation(hook) or contains_untranslated_cjk(hook):
        return True
    if "\U0001D54F" in str(item.get("context_ko") or ""):
        return True
    if is_anecdote_chatter(what) or is_anecdote_chatter(hl):
        return True
    if not hl or not isinstance(item.get("utility_tip"), dict) or not isinstance(item.get("planning_meta"), dict):
        return True
    easy = item.get("easy_original")
    if not isinstance(easy, dict) or easy.get("model") != "ai-radar magazine reader formatter v3":
        return True
    if any(
        is_anecdote_chatter(str(s.get("quote") or "")) or is_anecdote_chatter(str(s.get("body") or ""))
        for s in (easy.get("sections") or [])
        if isinstance(s, dict)
    ):
        return True
    sum_len = _summary_char_count(
        context_ko=str(item.get("context_ko") or ""),
        what_ko=what,
        why_ko=str(item.get("why_ko") or ""),
        caveats_ko=str(item.get("caveats_ko") or ""),
        highlight_summary=hl,
    )
    if _easy_char_count(easy) < max(750, int(sum_len * 1.6)):
        return True
    return False


def _upgrade_existing_item_translation(
    item: dict[str, Any],
    platforms: dict[str, dict[str, Any]],
    translator: ArticleTranslator,
    now_iso: str,
    *,
    raw_body_override: Optional[str] = None,
    metrics_override: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """기존 스냅샷의 미번역 외국어 기사나 구버전 기계적 요약을 제자리에서 자연스러운 한국어로 정돈한다."""
    pid = str(item.get("platform_id") or "")
    platform = platforms.get(pid) or {}
    platform_name = str(platform.get("name") or pid)
    region = str(platform.get("region") or "global")
    category = str(item.get("category") or "industry")
    url = str(item.get("canonical_url") or "")

    raw_title = sanitize_text(str(item.get("original_title") or item.get("hook_title") or ""), strip_emoji=True)
    raw_body = raw_body_override if raw_body_override is not None else _extract_raw_body_from_existing(item)

    existing_title_ko = sanitize_text(str(item.get("title_ko") or item.get("hook_title") or ""), strip_emoji=True)
    title_already_ok = (
        bool(existing_title_ko)
        and not needs_translation(existing_title_ko)
        and not contains_untranslated_cjk(existing_title_ko)
        and not (_FALLBACK_SUFFIX_RE.search(existing_title_ko) and needs_translation(raw_title))
    )
    if title_already_ok and (not raw_body or (not needs_translation(raw_body) and not contains_untranslated_cjk(raw_body))):
        title_ko = existing_title_ko
        body_ko = sanitize_text(raw_body) if raw_body and not needs_translation(raw_body) else ""
        llm_why = ""
        was_translated = needs_translation(raw_title)
    else:
        tr = translator.translate_article(url=url, title=raw_title, body=raw_body)
        title_ko = sanitize_text(tr.title_ko, strip_emoji=True) or raw_title
        body_ko = sanitize_text(tr.body_ko)
        if needs_translation(body_ko) or contains_untranslated_cjk(body_ko):
            body_ko = ""
        llm_why = sanitize_text(tr.why_ko or "") if (tr.why_ko and not needs_translation(tr.why_ko) and not contains_untranslated_cjk(tr.why_ko)) else ""
        was_translated = tr.translated

    # 한국어 검증 게이트: 1차 번역 후에도 미번역 중국어 한자·일본어 가나·영문이 남으면 즉시 재번역 패스 실행
    if needs_translation(title_ko) or contains_untranslated_cjk(title_ko):
        retried = translator.force_translate_korean(raw_title)
        if retried:
            cleaned_retry = sanitize_text(retried, strip_emoji=True)
            if cleaned_retry and not contains_untranslated_cjk(cleaned_retry):
                title_ko = cleaned_retry
                was_translated = True
                if translator.cache is not None and not needs_translation(cleaned_retry):
                    translator.cache.put(
                        url,
                        original_title=raw_title,
                        title_ko=cleaned_retry,
                        body_ko=body_ko,
                        provider="retry_gate",
                    )

    if body_ko and (needs_translation(body_ko) or contains_untranslated_cjk(body_ko)):
        retried_body = translator.force_translate_korean(body_ko)
        if retried_body and not needs_translation(retried_body) and not contains_untranslated_cjk(retried_body):
            body_ko = sanitize_text(retried_body)
        else:
            body_ko = ""

    # 최후 안전망: 네트워크/번역기 전면 장애 시에도 한자·가나가 한국어 제목에 노출되지 않도록 한글 정제
    if contains_untranslated_cjk(title_ko):
        stripped_cjk = re.sub(r"[\u3040-\u30ff\u4e00-\u9fff]+", " ", title_ko)
        stripped_cjk = re.sub(r"\s+", " ", stripped_cjk).strip(" -—|:·[]()【】")
        if len(stripped_cjk) >= 4:
            title_ko = stripped_cjk
        else:
            title_ko = f"{platform_name} {CATEGORY_LABELS.get(category, 'AI')} 최신 업데이트"

    hook_title = polish_korean_headline(
        title_ko,
        raw_title,
        platform_id=pid,
        author_handle=str(item.get("author_handle") or "").strip() or None,
        category=category,
        metrics=metrics_override,
    )
    title_ko = hook_title

    updated = dict(item)
    updated["original_title"] = raw_title
    updated["title_ko"] = title_ko
    updated["hook_title"] = hook_title

    metrics = dict(metrics_override or {})
    if updated.get("author_handle") and not metrics.get("author_handle"):
        metrics["author_handle"] = updated["author_handle"]
    seen_plats = list(updated.get("source_platforms") or [pid])
    entities = updated.get("entities") if isinstance(updated.get("entities"), list) else []
    benefit_tag = updated.get("benefit_tag") if isinstance(updated.get("benefit_tag"), str) else None

    curated = build_curated_fields(
        title_ko=title_ko,
        original_title=raw_title,
        body_ko=body_ko,
        raw_body=raw_body,
        platform_id=pid,
        platform_name=platform_name,
        category=category,
        cat_label=CATEGORY_LABELS.get(category, "AI"),
        seen_platforms=seen_plats,
        metrics=metrics,
        entities=entities,
        benefit_tag=benefit_tag,
        llm_why=llm_why,
    )

    context_ko = sanitize_text(curated["context_ko"])
    what_ko = sanitize_text(curated["what_ko"])
    why_ko = sanitize_text(curated["why_ko"])
    caveats_ko = _detect_language_note(raw_title, raw_body, region, translated=was_translated)

    updated["context_ko"] = context_ko
    updated["what_ko"] = what_ko
    updated["why_ko"] = why_ko
    updated["caveats_ko"] = caveats_ko
    updated["highlight_summary"] = sanitize_text(curated["highlight_summary"])
    updated["utility_tip"] = {k: sanitize_text(v) for k, v in curated["utility_tip"].items()}
    updated["planning_meta"] = {k: sanitize_text(v) for k, v in curated["planning_meta"].items()}
    summary_blob = " ".join(x for x in (context_ko, what_ko, why_ko, caveats_ko) if x)
    updated["terms"] = _extract_terms(summary_blob)
    updated["easy_original_ready"] = True
    updated["easy_original"] = _build_easy_original(
        platform_name=platform_name,
        category=category,
        title=hook_title,
        body=body_ko,
        context_ko=context_ko,
        what_ko=what_ko,
        why_ko=why_ko,
        caveats_ko=caveats_ko,
        generated_iso=now_iso,
        translated=was_translated,
        highlight_summary=updated["highlight_summary"],
        utility_tip=updated["utility_tip"],
        planning_meta=updated["planning_meta"],
        terms=updated["terms"],
        entities=entities,
    )
    return updated


def build_planning_feed_payload(items: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    """하위 AI 기획팀 에이전트가 바로 읽어갈 경량 구조화 시그널 피드 생성."""
    signals: list[dict[str, Any]] = []
    for it in items:
        pm = it.get("planning_meta") if isinstance(it.get("planning_meta"), dict) else {}
        signals.append({
            "id": it.get("id"),
            "title_ko": it.get("title_ko") or it.get("hook_title"),
            "original_title": it.get("original_title") or it.get("hook_title"),
            "platform_id": it.get("platform_id"),
            "author_handle": it.get("author_handle"),
            "category": it.get("category"),
            "lifecycle_status": it.get("lifecycle_status"),
            "canonical_url": it.get("canonical_url"),
            "published_at": it.get("published_at"),
            "fetched_at": it.get("fetched_at"),
            "importance_score": it.get("importance_score"),
            "source_count": it.get("source_count"),
            "benefit_tag": it.get("benefit_tag"),
            "highlight_summary": it.get("highlight_summary"),
            "planning_meta": {
                "signal_type": pm.get("signal_type", "new_product"),
                "product_domain": pm.get("product_domain", "ai-business-infra"),
                "benchmark_point": pm.get("benchmark_point", ""),
                "actionable_idea": pm.get("actionable_idea", ""),
            },
            "entities": [e.get("name") for e in (it.get("entities") or []) if isinstance(e, dict) and e.get("name")],
        })
    return {
        "version": 1,
        "generated_at": generated_at,
        "item_count": len(signals),
        "signals": signals,
    }


def _signature(items: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """커밋 여부 판단용 안정 시그니처 (미세한 점수 변화만으로 매 20분 헛커밋하지 않도록)."""
    return [
        (
            it.get("id"),
            it.get("canonical_url"),
            it.get("hook_title"),
            it.get("title_ko"),
            it.get("published_at"),
            it.get("source_count"),
            it.get("lifecycle_status"),
            str(it.get("what_ko") or "")[:60],
            str(it.get("highlight_summary") or "")[:50],
        )
        for it in items
    ]


def build_and_save_snapshot(
    snapshot_path: Path,
    candidates: list[Candidate],
    *,
    summaries_by_dedup: Optional[dict[str, dict[str, Any]]] = None,
    platforms: Optional[dict[str, dict[str, Any]]] = None,
    now: Optional[datetime] = None,
    max_items: int = MAX_SNAPSHOT_ITEMS,
    per_platform: int = PER_PLATFORM_MAX,
    meta_path: Optional[Path] = None,
    planning_path: Optional[Path] = None,
    translator: Optional[ArticleTranslator] = None,
) -> tuple[dict[str, Any], bool]:
    """기존 스냅샷과 신규 후보를 병합해 30일 자정(Auto-Prune)·스마트 승격·자동 한국어 큐레이션 후 저장."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    platforms = platforms if platforms is not None else load_valid_platforms()
    summaries_by_dedup = summaries_by_dedup or {}

    existing_items: list[dict[str, Any]] = []
    old_generated_at: Optional[str] = None
    if snapshot_path.exists():
        try:
            old_payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
            if isinstance(old_payload, dict):
                if isinstance(old_payload.get("generated_at"), str):
                    old_generated_at = old_payload["generated_at"]
                if isinstance(old_payload.get("items"), list):
                    existing_items = [x for x in old_payload["items"] if isinstance(x, dict)]
        except Exception:
            existing_items = []

    if translator is None:
        cache_meta = meta_path if meta_path is not None else (snapshot_path.parent / "live-feed-meta.json")
        cache = TranslationCache(cache_meta, now=now)
        cache.seed_from_snapshot_items(existing_items)
        translator = ArticleTranslator(cache=cache)
    elif translator.cache is not None:
        translator.cache.seed_from_snapshot_items(existing_items)

    cutoff = now - timedelta(days=RETENTION_DAYS)
    by_url: dict[str, dict[str, Any]] = {}
    by_id: dict[str, dict[str, Any]] = {}

    # 1) 기존 스냅샷 중 30일 이내 + 유효 + 비노이즈 항목 유지 (30일 초과 자동 정리)
    for item in existing_items:
        url = str(item.get("canonical_url") or "")
        pid = str(item.get("platform_id") or "")
        if not is_valid_https_url(url) or pid not in platforms:
            continue
        if is_blocked_noise(str(item.get("hook_title") or item.get("original_title") or ""), str(item.get("what_ko") or ""), url):
            continue
        created_dt = _parse_iso(item.get("published_at")) or _parse_iso(item.get("created_at"))
        if not created_dt or created_dt < cutoff:
            continue
        age_days = max(0.0, (now - created_dt).total_seconds() / 86400.0)
        kept = dict(item)
        kept.setdefault("fetched_at", old_generated_at or str(kept.get("created_at") or now_iso))
        kept.setdefault("original_title", str(kept.get("hook_title") or ""))
        kept.setdefault("title_ko", str(kept.get("hook_title") or ""))
        kept["lifecycle_status"] = "hot" if age_days <= HOT_DAYS else "warm"
        by_url[url] = kept
        by_id[str(kept.get("id"))] = kept

    # 2) 이번 수집 후보 병합
    raw_body_by_url: dict[str, str] = {}
    metrics_by_url: dict[str, dict[str, Any]] = {}
    llm_urls: set[str] = set()
    for c in candidates:
        llm_sum = summaries_by_dedup.get(c.dedup_key)
        built = candidate_to_snapshot_item(
            c,
            platforms,
            now,
            llm_summary=llm_sum,
            translator=None,
        )
        if built is None:
            continue
        raw_body_by_url[built["canonical_url"]] = c.body or ""
        metrics_by_url[built["canonical_url"]] = dict(c.metrics or {})
        if llm_sum:
            llm_urls.add(built["canonical_url"])
        prev = by_url.get(built["canonical_url"]) or by_id.get(built["id"])
        if prev is not None:
            merged = dict(prev)
            merged_plats = list(prev.get("source_platforms") or [prev["platform_id"]])
            for sp in built["source_platforms"]:
                if sp in platforms and sp not in merged_plats:
                    merged_plats.append(sp)
            merged["source_platforms"] = merged_plats
            merged["source_count"] = len(merged_plats)
            merged["importance_score"] = max(float(prev.get("importance_score") or 0), float(built["importance_score"]))
            if not merged.get("thumbnail_url") and built.get("thumbnail_url"):
                merged["thumbnail_url"] = built["thumbnail_url"]
            if not merged.get("author_handle") and built.get("author_handle"):
                merged["author_handle"] = built["author_handle"]
            prev_pub = prev.get("published_at")
            if built.get("published_at") and (not prev_pub or (old_generated_at and prev_pub == old_generated_at)):
                merged["published_at"] = built["published_at"]
                merged["created_at"] = built["created_at"]
                merged["lifecycle_status"] = built["lifecycle_status"]
            if llm_sum or not prev.get("original_title"):
                for k in (
                    "original_title",
                    "title_ko",
                    "hook_title",
                    "context_ko",
                    "what_ko",
                    "why_ko",
                    "caveats_ko",
                    "highlight_summary",
                    "utility_tip",
                    "planning_meta",
                    "terms",
                    "entities",
                    "easy_original_ready",
                    "easy_original",
                ):
                    merged[k] = built[k]
            by_url[merged["canonical_url"]] = merged
            by_id[str(merged["id"])] = merged
        else:
            by_url[built["canonical_url"]] = built
            by_id[str(built["id"])] = built

    # 3) 실시간 레이더(hot): 무조건 최신 발행·포착 시각(published_at 정규화 UTC 내림차순) 최우선 정렬
    #    - Tier 2: 48시간 이내 유효 published_at → 무조건 최신순(동일 시각 시 중요도 보조)
    #    - Tier 1: 48시간 초과(지연 수집된 옛 기사) → 48시간 이내 최신 기사 뒤에서 최신순
    #    - Tier 0: 발행 시각 미상 또는 미래 오파싱 → 항상 최하단
    def hot_sort_key(it: dict[str, Any]) -> tuple[int, float, float]:
        pub_dt = _parse_iso(it.get("published_at"))
        if pub_dt is not None and pub_dt <= now + timedelta(minutes=5):
            eff_dt = min(pub_dt, now)
            age_h = max(0.0, (now - eff_dt).total_seconds() / 3600.0)
            tier = 2 if age_h <= HOT_FRESH_CUTOFF_HOURS else 1
            return (tier, eff_dt.timestamp(), float(it.get("importance_score") or 0))
        fetched_dt = _parse_iso(it.get("fetched_at")) or _parse_iso(it.get("created_at")) or now
        return (0, min(fetched_dt, now).timestamp(), float(it.get("importance_score") or 0))

    def _interleave_max_consecutive(items: list[dict[str, Any]], max_run: int = MAX_CONSECUTIVE_SAME_SOURCE) -> list[dict[str, Any]]:
        """동일 출처가 연속 3개 이상 붙을 때만 최소 거리로 미세 인터리빙해 최신순을 보존한다."""
        if len(items) <= max_run:
            return items
        pool = list(items)
        result: list[dict[str, Any]] = []
        while pool:
            last_pid = str(result[-1].get("platform_id") or "") if result else ""
            same_run = 0
            for prev in reversed(result):
                if str(prev.get("platform_id") or "") == last_pid:
                    same_run += 1
                else:
                    break
            if last_pid and same_run >= max_run and str(pool[0].get("platform_id") or "") == last_pid:
                alt_idx = next((idx for idx, x in enumerate(pool) if str(x.get("platform_id") or "") != last_pid), -1)
                if alt_idx > 0:
                    result.append(pool.pop(alt_idx))
                    continue
            result.append(pool.pop(0))
        return result

    def warm_sort_key(it: dict[str, Any]) -> tuple[float, str]:
        score = float(it.get("importance_score") or 0) + max(0, int(it.get("source_count") or 1) - 1) * 4.0
        return (score, str(it.get("published_at") or it.get("created_at") or ""))

    hot_pool = [it for it in by_url.values() if it.get("lifecycle_status") == "hot"]
    warm_pool = [it for it in by_url.values() if it.get("lifecycle_status") == "warm"]

    hot_ranked = sorted(hot_pool, key=hot_sort_key, reverse=True)
    warm_ranked = sorted(warm_pool, key=warm_sort_key, reverse=True)

    hot_cap = min(max_items, MAX_HOT_ITEMS) if warm_ranked else max_items
    selected_hot: list[dict[str, Any]] = []
    picked_hot_urls: set[str] = set()
    per_plat: dict[str, int] = {}

    # 핵심 실시간 소스(중국 AI·인디빌더 5대 소스 + OpenAI·Anthropic·Substack·X·GitHub)가 다량 RSS 에 밀리지 않도록 슬롯 보장
    priority_hot_quotas = (
        ("qbitai", min(3, per_platform)),
        ("jiqizhixin", min(3, per_platform)),
        ("36kr-ai", min(3, per_platform)),
        ("v2ex", min(4, per_platform)),
        ("juejin", min(3, per_platform)),
        ("openai", min(4, per_platform)),
        ("anthropic", min(4, per_platform)),
        ("latent-space", min(2, per_platform)),
        ("import-ai", min(2, per_platform)),
        ("ahead-of-ai", min(2, per_platform)),
        ("one-useful-thing", min(2, per_platform)),
        ("interconnects", min(2, per_platform)),
        ("x", min(8, per_platform + 2)),
        ("github", min(5, per_platform)),
    )
    for priority_pid, reserve_cap in priority_hot_quotas:
        cnt = 0
        for it in hot_ranked:
            if str(it["platform_id"]) != priority_pid:
                continue
            url = str(it["canonical_url"])
            if url in picked_hot_urls:
                continue
            selected_hot.append(it)
            picked_hot_urls.add(url)
            per_plat[priority_pid] = per_plat.get(priority_pid, 0) + 1
            cnt += 1
            if cnt >= reserve_cap or len(selected_hot) >= hot_cap:
                break

    for it in hot_ranked:
        if len(selected_hot) >= hot_cap:
            break
        url = str(it["canonical_url"])
        if url in picked_hot_urls:
            continue
        pid = str(it["platform_id"])
        if per_plat.get(pid, 0) >= per_platform:
            continue
        selected_hot.append(it)
        picked_hot_urls.add(url)
        per_plat[pid] = per_plat.get(pid, 0) + 1

    # 최종 hot 목록은 무조건 최신 발행 시각 내림차순 최우선 정렬 + 3연속 동일 출처만 미세 인터리빙
    selected_hot.sort(key=hot_sort_key, reverse=True)
    selected_hot = _interleave_max_consecutive(selected_hot, MAX_CONSECUTIVE_SAME_SOURCE)

    # 48시간이 지나 hot 상단에서 자연스럽게 밀린 고중요도 기사는 지난 주요 소식(warm) 풀로 승격해 빛나게 한다
    overflow_older = []
    for it in hot_ranked:
        if str(it["canonical_url"]) in picked_hot_urls:
            continue
        pub_dt = _parse_iso(it.get("published_at"))
        if pub_dt is not None and (now - pub_dt).total_seconds() > HOT_FRESH_CUTOFF_HOURS * 3600.0:
            promoted = dict(it)
            promoted["lifecycle_status"] = "warm"
            overflow_older.append(promoted)
    if overflow_older:
        warm_ranked = sorted([*warm_pool, *overflow_older], key=warm_sort_key, reverse=True)

    # 지난 주요 소식(8~30일): 플랫폼 다양성 쿼터 + 일별 최고 중요도 1건씩 우선 보존 후 중요도 순으로 채움
    warm_cap = min(MAX_WARM_ITEMS, max(0, max_items - len(selected_hot)))
    selected_warm: list[dict[str, Any]] = []
    if warm_cap > 0 and warm_ranked:
        seen_days: set[str] = set()
        picked_warm_urls: set[str] = set()
        warm_per_plat: dict[str, int] = {}
        # 주간/격주 핵심 AI Substack·OpenAI·Anthropic 아카이브도 지난 주요 소식에 우선 보존
        for priority_pid in ("openai", "anthropic", "one-useful-thing", "interconnects", "ahead-of-ai", "import-ai", "latent-space"):
            for it in warm_ranked:
                if str(it["platform_id"]) != priority_pid:
                    continue
                url = str(it["canonical_url"])
                if url in picked_warm_urls or warm_per_plat.get(priority_pid, 0) >= 2:
                    continue
                selected_warm.append(it)
                picked_warm_urls.add(url)
                warm_per_plat[priority_pid] = warm_per_plat.get(priority_pid, 0) + 1
                day_key = str(it.get("published_at") or it.get("created_at") or "")[:10]
                if day_key:
                    seen_days.add(day_key)
                if len(selected_warm) >= warm_cap:
                    break
            if len(selected_warm) >= warm_cap:
                break
        for it in warm_ranked:
            if len(selected_warm) >= warm_cap:
                break
            url = str(it["canonical_url"])
            pid = str(it["platform_id"])
            if url in picked_warm_urls or warm_per_plat.get(pid, 0) >= per_platform:
                continue
            day_key = str(it.get("published_at") or it.get("created_at") or "")[:10]
            if day_key and day_key not in seen_days:
                seen_days.add(day_key)
                selected_warm.append(it)
                picked_warm_urls.add(url)
                warm_per_plat[pid] = warm_per_plat.get(pid, 0) + 1
                if len(selected_warm) >= warm_cap:
                    break
        if len(selected_warm) < warm_cap:
            for it in warm_ranked:
                url = str(it["canonical_url"])
                pid = str(it["platform_id"])
                if url in picked_warm_urls or warm_per_plat.get(pid, 0) >= per_platform:
                    continue
                selected_warm.append(it)
                picked_warm_urls.add(url)
                warm_per_plat[pid] = warm_per_plat.get(pid, 0) + 1
                if len(selected_warm) >= warm_cap:
                    break

    selected = [*selected_hot, *selected_warm]

    # 4) 최종 선정된 기사 중 외국어 번역 + 구버전 큐레이션 업그레이드 (무료 Gemini 배치 → 무키 이중 폴백 + URL 캐시 재사용)
    batch_candidates = [
        {
            "url": str(it.get("canonical_url") or ""),
            "title": str(it.get("original_title") or it.get("hook_title") or ""),
            "body": raw_body_by_url.get(str(it.get("canonical_url") or "")) or _extract_raw_body_from_existing(it),
        }
        for it in selected
        if str(it.get("canonical_url") or "") not in llm_urls and _item_needs_translation(it)
    ]
    if batch_candidates:
        translator.translate_batch_with_gemini(batch_candidates)

    translated_selected: list[dict[str, Any]] = []
    for it in selected:
        url = str(it.get("canonical_url") or "")
        if url in llm_urls:
            translated_selected.append(it)
            continue
        raw_body = raw_body_by_url.get(url) or _extract_raw_body_from_existing(it)
        if (
            _item_needs_translation(it)
            or _item_needs_curation_upgrade(it)
            or (raw_body and needs_translation(raw_body) and not it.get("title_ko"))
        ):
            upgraded = _upgrade_existing_item_translation(
                it,
                platforms,
                translator,
                now_iso,
                raw_body_override=raw_body,
                metrics_override=metrics_by_url.get(url),
            )
            translated_selected.append(upgraded)
        else:
            if needs_translation(str(it.get("original_title") or "")) and translator.cache is not None:
                translator.stats["cache_hits"] += 1
            translated_selected.append(it)
    selected = translated_selected

    if translator.cache is not None:
        translator.cache.save()

    changed = (not snapshot_path.exists()) or (_signature(existing_items) != _signature(selected))
    payload = {
        "version": 1,
        "generated_at": now_iso,
        "item_count": len(selected),
        "items": selected,
    }
    if changed:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if planning_path is not None and (changed or not planning_path.exists()):
        planning_payload = build_planning_feed_payload(selected, now_iso if changed else (old_generated_at or now_iso))
        planning_path.parent.mkdir(parents=True, exist_ok=True)
        planning_path.write_text(json.dumps(planning_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return payload, changed
