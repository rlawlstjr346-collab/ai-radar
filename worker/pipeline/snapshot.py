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

from pipeline.merge import Candidate
from pipeline.store import load_seed_platform_names
from pipeline.translator import (
    ArticleTranslator,
    TranslationCache,
    clean_source_boilerplate,
    needs_translation,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PLATFORMS_SAMPLE_JSON = REPO_ROOT / "web" / "src" / "data" / "platforms.sample.json"

RETENTION_DAYS = 30
HOT_DAYS = 7
MAX_SNAPSHOT_ITEMS = 80
PER_PLATFORM_MAX = 5

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
) -> dict[str, Any]:
    cat_label = CATEGORY_LABELS.get(category, "AI")
    excerpt = _clean_excerpt(body, 650)
    if needs_translation(excerpt):
        excerpt = ""
    quote = _short_quote(body)
    sections: list[dict[str, Any]] = [
        {
            "heading": f"배경: {platform_name}에서 올라온 {cat_label} 소식",
            "body": context_ko,
            "quote": None,
        },
        {
            "heading": "핵심 내용: 원문이 전하는 요지",
            "body": what_ko,
            "quote": quote,
        },
    ]
    if excerpt and excerpt not in what_ko and len(excerpt) >= 60:
        sections.append({
            "heading": "핵심 본문 한국어 정리" if translated else "원문 상세 발췌 살펴보기",
            "body": f"원문 본문에는 다음 내용이 담겨 있어요. {excerpt}",
            "quote": None,
        })
    sections.append({
        "heading": "의미와 읽을 때 참고 포인트",
        "body": f"{why_ko} {caveats_ko}".strip(),
        "quote": None,
    })

    display_title = title[:60]
    watch_points = [
        f"핵심 주제('{display_title}')와 첫 문단을 먼저 훑으면 핵심 주장을 빠르게 파악할 수 있어요.",
        "본문 속 수치·비교 조건·버전 정보와 댓글/이슈 반응은 아래 원문 링크에서 직접 확인해 보세요.",
    ]
    source_note = (
        f"{platform_name} 공식 피드 원문을 한국어로 자동 번역해 흐름에 맞춰 정리했어요."
        if translated
        else f"{platform_name} 공식 피드 자동 수집본을 원문 흐름에 맞춰 정리했어요."
    )
    return {
        "sections": sections,
        "watch_points": watch_points,
        "source_note": source_note,
        "generated_at": generated_iso,
        "model": "ai-radar live-snapshot formatter v2",
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
    if c.platform_id in {"bluesky", "x"} and len(raw_title) < 12:
        return None
    if c.platform_id == "aitimes" and not KR_AI_NEWS_RE.search(f"{raw_title} {c.body[:300]}"):
        return None

    was_translated = False
    body_for_easy = _clean_excerpt(c.body, 750)
    title_ko = raw_title

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

        hook_title = title_ko if len(title_ko) <= 78 else title_ko[:77].rstrip() + "…"
        benefit_tag = _benefit_tag_for(c)
        cat_label = CATEGORY_LABELS.get(c.category, "AI")
        multi_note = f" (총 {len(seen_plats)}개 출처에서 동시 포착)" if len(seen_plats) > 1 else ""
        context_ko = f"{platform_name} 공식 피드에서 포착된 {cat_label} 분야 최신 소식이에요{multi_note}."
        excerpt_ko = _clean_excerpt(body_ko, 300) if body_ko else ""
        if excerpt_ko and excerpt_ko.lower() != title_ko.lower() and not needs_translation(excerpt_ko):
            what_ko = f"'{hook_title}'에 관한 소식이에요. 핵심 내용: {excerpt_ko}"
        else:
            what_ko = f"{platform_name}에서 '{hook_title}' 소식을 공개했어요. 자세한 배경과 상세 내용은 원문에서 바로 확인할 수 있어요."
        analogy_ko = None
        why_ko = llm_why if (llm_why and not needs_translation(llm_why)) else CATEGORY_WHY.get(c.category, CATEGORY_WHY["industry"])
        caveats_ko = _detect_language_note(raw_title, c.body, region, translated=was_translated)
        difficulty = _difficulty_for(c)
        summary_blob = " ".join(x for x in (context_ko, what_ko, why_ko, caveats_ko) if x)
        terms = _extract_terms(summary_blob)
        entities = _extract_entities(c, platform_name)
        body_for_easy = body_ko

    if not context_ko:
        context_ko = f"{platform_name}에서 새로 포착된 AI 소식이에요."
    if not what_ko:
        what_ko = f"'{hook_title}' 소식이 공개됐어요."
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


def _item_needs_translation(item: dict[str, Any]) -> bool:
    """기존 스냅샷 항목에 미번역 외국어 제목·본문·완독해설이 남아 있는지 확인."""
    if needs_translation(str(item.get("hook_title") or "")):
        return True
    if needs_translation(str(item.get("what_ko") or "")):
        return True
    easy = item.get("easy_original")
    if isinstance(easy, dict):
        for sec in easy.get("sections") or []:
            if not isinstance(sec, dict):
                continue
            if needs_translation(str(sec.get("body") or "")):
                return True
            if sec.get("quote") and needs_translation(str(sec.get("quote") or "")):
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


def _upgrade_existing_item_translation(
    item: dict[str, Any],
    platforms: dict[str, dict[str, Any]],
    translator: ArticleTranslator,
    now_iso: str,
    *,
    raw_body_override: Optional[str] = None,
) -> dict[str, Any]:
    """기존 스냅샷의 미번역 외국어 기사를 제자리에서 한국어로 정돈한다."""
    pid = str(item.get("platform_id") or "")
    platform = platforms.get(pid) or {}
    platform_name = str(platform.get("name") or pid)
    region = str(platform.get("region") or "global")
    category = str(item.get("category") or "industry")
    url = str(item.get("canonical_url") or "")

    raw_title = sanitize_text(str(item.get("original_title") or item.get("hook_title") or ""), strip_emoji=True)
    raw_body = raw_body_override if raw_body_override is not None else _extract_raw_body_from_existing(item)
    tr = translator.translate_article(url=url, title=raw_title, body=raw_body)

    title_ko = sanitize_text(tr.title_ko, strip_emoji=True) or raw_title
    hook_title = title_ko if len(title_ko) <= 78 else title_ko[:77].rstrip() + "…"
    body_ko = sanitize_text(tr.body_ko)
    if needs_translation(body_ko):
        body_ko = ""

    updated = dict(item)
    updated["original_title"] = raw_title
    updated["title_ko"] = title_ko
    updated["hook_title"] = hook_title

    context_ko = str(updated.get("context_ko") or f"{platform_name}에서 새로 포착된 AI 소식이에요.")
    excerpt_ko = _clean_excerpt(body_ko, 300) if body_ko else ""
    if excerpt_ko and excerpt_ko.lower() != title_ko.lower() and not needs_translation(excerpt_ko):
        what_ko = f"'{hook_title}'에 관한 소식이에요. 핵심 내용: {excerpt_ko}"
    else:
        what_ko = f"{platform_name}에서 '{hook_title}' 소식을 공개했어요. 자세한 배경과 상세 내용은 원문에서 바로 확인할 수 있어요."

    why_ko = sanitize_text(tr.why_ko or "") if (tr.why_ko and not needs_translation(tr.why_ko)) else str(
        updated.get("why_ko") or CATEGORY_WHY.get(category, CATEGORY_WHY["industry"])
    )
    caveats_ko = _detect_language_note(raw_title, raw_body, region, translated=tr.translated)

    updated["context_ko"] = context_ko
    updated["what_ko"] = what_ko
    updated["why_ko"] = why_ko
    updated["caveats_ko"] = caveats_ko
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
        translated=tr.translated,
    )
    return updated


def _signature(items: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """커밋 여부 판단용 안정 시그니처 (미세한 점수 변화만으로 매시간 헛커밋하지 않도록)."""
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
    translator: Optional[ArticleTranslator] = None,
) -> tuple[dict[str, Any], bool]:
    """기존 스냅샷과 신규 후보를 병합해 30일 TTL·자동 한국어 번역 적용 후 저장. 변경이 있을 때만 파일을 갱신한다."""
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

    # 1) 기존 스냅샷 중 30일 이내 + 유효 항목 유지
    for item in existing_items:
        url = str(item.get("canonical_url") or "")
        pid = str(item.get("platform_id") or "")
        if not is_valid_https_url(url) or pid not in platforms:
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

    # 2) 이번 수집 후보 병합 (선별 전 번역 호출을 아끼기 위해 여기서는 구조화만 수행하고, 최종 선정 80건만 번역한다)
    raw_body_by_url: dict[str, str] = {}
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
            # 실제 원문 발행 시각이 새로 확보되었거나 이전 버전에서 생성 시각으로 덮여 있었다면 교정
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

    # 3) 플랫폼 다양성 쿼터 적용 + 최신성·중요도 정렬 (발행일 확인된 최근 24~48시간 기사 최우선)
    def sort_key(it: dict[str, Any]) -> tuple[int, float, str]:
        pub_dt = _parse_iso(it.get("published_at"))
        created_dt = pub_dt or _parse_iso(it.get("created_at")) or now
        age_h = max(0.0, (now - created_dt).total_seconds() / 3600.0)
        effective_age = age_h if pub_dt is not None else max(age_h, 36.0)
        hot_rank = float(it.get("importance_score") or 0) / ((effective_age + 2.0) ** 1.5)
        if pub_dt is None:
            hot_rank *= 0.25
        is_hot = 1 if it.get("lifecycle_status") == "hot" else 0
        return (is_hot, hot_rank, str(it.get("published_at") or it.get("created_at") or ""))

    ranked = sorted(by_url.values(), key=sort_key, reverse=True)
    selected: list[dict[str, Any]] = []
    per_plat: dict[str, int] = {}
    for it in ranked:
        pid = str(it["platform_id"])
        if per_plat.get(pid, 0) >= per_platform:
            continue
        selected.append(it)
        per_plat[pid] = per_plat.get(pid, 0) + 1
        if len(selected) >= max_items:
            break

    # 4) 최종 선정된 기사(최대 80건) 중 외국어 기사만 선별 번역 + URL 캐시 재사용
    translated_selected: list[dict[str, Any]] = []
    for it in selected:
        url = str(it.get("canonical_url") or "")
        if url in llm_urls:
            translated_selected.append(it)
            continue
        raw_body = raw_body_by_url.get(url) or _extract_raw_body_from_existing(it)
        if _item_needs_translation(it) or (raw_body and needs_translation(raw_body) and not it.get("title_ko")):
            upgraded = _upgrade_existing_item_translation(
                it,
                platforms,
                translator,
                now_iso,
                raw_body_override=raw_body,
            )
            translated_selected.append(upgraded)
        else:
            # 이미 한국어(또는 이전 실행에서 번역 완료된 캐시 항목)
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
    return payload, changed
