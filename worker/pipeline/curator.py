"""웹 고유 AI 큐레이터 — 노이즈 차단 + 제목 핵심어 기반 핵심 문장 추출(도입부 잡담 제거) + 형광펜 핵심 요약 + 실전 효용 + 기획팀 메타.

원칙:
- '...에 관한 소식이에요' 같은 기계적 복붙 문구 금지
- [독서 모임 모집], 채용, 수강생/참가자 모집 등 모객·홍보성 글 원천 차단
- 커뮤니티/블로그 서두의 개인 일화·잡담(예: '로이킴 팬이 되어 콘서트를 다녀왔습니다')이 핵심 요약으로
  오추출되지 않도록 제목의 핵심 기술·주제어와 의미적 겹침이 높은 본문 핵심/결론 문장만 선별한다.
- 1분 핵심 요약은 압축 브리핑(짧고 명쾌), 원본 쉽게 읽기는 최소 2~3배 분량의 풍성한 아티클로 구성한다.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# ── 모객·채용·홍보 노이즈 차단 필터 ────────────────────────────────────────────
BLOCKED_NOISE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\[?\s*독서\s*모임\s*모집\s*\]?", re.I),
    re.compile(r"(독서\s*모임|북클럽|스터디\s*모집|스터디원\s*모집|수강생\s*모집|부트캠프\s*모집)", re.I),
    re.compile(r"(채용\s*공고|개발자\s*채용|인재\s*영입|함께할\s*동료를\s*찾습니다|포지션\s*모집)", re.I),
    re.compile(r"(웨비나\s*참가자?\s*모집|세미나\s*참가\s*신청|사전\s*등록\s*이벤트|얼리버드\s*할인|선착순\s*모집|모객)", re.I),
    re.compile(r"\b(we['’]?re\s+hiring|we\s+are\s+hiring|job\s+opening|join\s+our\s+team|sponsored\s+post|discount\s+code|giveaway)\b", re.I),
    re.compile(r"github\.com/[^/]+/[^/\s]+-(?:pro-)?(?:win|mac|crack|keygen)(?:$|[^a-z0-9])", re.I),
)

# ── 블로그/커뮤니티 서두 개인 일화·잡담·인사말 감점 패턴 ─────────────────────────
ANECDOTE_INTRO_RE = re.compile(
    r"(안녕하세요|반갑습니다|오랜만에|어느덧|팬이\s*되어|팬\s*계정|콘서트를?\s*다녀|막콘|연말마다|주말에|퇴근\s*후|"
    r"요즘\s*날씨|일상\s*이야기|개인적인|사담|잡담|구독과\s*좋아요|들어가며|시작하며|목차\s*:|"
    r"이번\s*포스팅에서는|오늘\s*글에서는|오늘은\s*제가|저의\s*경험을|여행을\s*다녀|카페에서|"
    r"\b(hello\s+everyone|welcome\s+back|in\s+this\s+blog\s+post|table\s+of\s+contents|subscribe\s+to\s+my)\b)",
    re.I,
)

TECH_SIGNAL_RE = re.compile(
    r"(\bAI\b|인공지능|LLM|GPT|Claude|클로드|Gemini|제미나이|OpenAI|Anthropic|Apple\s+Intelligence|MLX|Core\s*ML|"
    r"MCP|RAG|API|SDK|에이전트|agent|모델|추론|파인튜닝|오픈소스|벤치마크|자동화|편집|코드|코딩|워크플로|"
    r"배포|성능|속도|비용|토큰|프롬프트|이미지|영상|음성|릴스|프로토타입|데이터|아키텍처|플러그인|툴|앱|웹)",
    re.I,
)

CONCLUSION_SIGNAL_RE = re.compile(
    r"(결론|결과적으로|핵심은|요약하면|정리하면|장점은|차이점은|비교해\s*보면|개선|단축|절감|향상|지원합니다|공개했습니다|"
    r"출시했습니다|발표했습니다|가능합니다|해결합니다|제공합니다|추천합니다|활용할\s*수)",
    re.I,
)

METRIC_PHRASE_RE = re.compile(
    r"(?:\$?\d[\d,]*(?:\.\d+)?\s?(?:%|퍼센트|배|달러|센트|원|위|점|만|억|조|ms|초|시간|stars?|스타|K|M|B)|v\d+\.\d+(?:\.\d+)?)",
    re.I,
)

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|(?<=[다요음함]\.)\s+|\n+")
TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{1,}|[가-힣]{2,}")

STOPWORDS = {
    "하는", "하고", "에서", "으로", "에게", "까지", "부터", "대한", "관한", "위한", "통한", "있는", "없는",
    "어떨까", "어떻게", "무엇", "왜", "방법", "정리", "소개", "리뷰", "후기", "소식", "최신", "오늘", "이번",
    "그리고", "하지만", "그러나", "그래서", "때문", "입니다", "합니다", "해요", "했어요", "있습니다", "있어요",
    "the", "and", "for", "with", "from", "that", "this", "into", "over", "how", "why", "what", "when", "new",
    "using", "about", "your", "our", "are", "was", "were", "can", "will", "not", "all", "more", "just",
}

CATEGORY_DOMAIN_MAP: dict[str, str] = {
    "llm_chat": "chatbot-productivity",
    "dev": "coding-agent-devtool",
    "image_design": "image-design-studio",
    "video_audio": "video-audio-media",
    "research": "ai-research-model",
    "industry": "ai-business-infra",
    "social": "builder-community-signal",
}

CATEGORY_UTILITY: dict[str, dict[str, str]] = {
    "llm_chat": {
        "when_needed": "문서 요약·고객 응대·리서치 자동화처럼 대화형 AI의 정확도와 비용 효율을 함께 높여야 할 때",
        "work_utility": "웹·앱 내 AI 비서 응답 품질을 끌어올리거나, 모델 교체만으로 토큰 단가와 대기 시간을 줄일 수 있어요.",
        "practical_tip": "자주 쓰는 사내 프롬프트 3~5개를 동일 입력으로 돌려 응답 품질·속도·가격을 기존 모델과 나란히 비교해 보세요.",
    },
    "dev": {
        "when_needed": "코딩 에이전트, 자동화 파이프라인, MCP·SDK 연동으로 개발·배포 속도를 높이고 싶을 때",
        "work_utility": "반복 구현 시간을 크게 줄이고, AI 기능을 기존 백엔드·프런트엔드 구조에 안전하게 붙이는 실무 기준이 돼요.",
        "practical_tip": "작은 사이드 브랜치나 테스트 엔드포인트 하나에 먼저 붙여 빌드·에러 처리 흐름부터 검증해 보세요.",
    },
    "image_design": {
        "when_needed": "랜딩 페이지 비주얼, 썸네일, UI 시안, 제품 컷을 적은 인력으로 빠르게 대량 제작해야 할 때",
        "work_utility": "디자인 시안 반복 주기를 단축하고 일관된 브랜드 톤의 시각 자산을 자동 생성하는 파이프라인으로 확장해요.",
        "practical_tip": "브랜드 컬러·구도 가이드를 고정 템플릿으로 두고 시안 4~8장을 한 번에 뽑아 비교해 보세요.",
    },
    "video_audio": {
        "when_needed": "제품 데모 영상, 숏폼 릴스 편집, 다국어 더빙·음성 인터페이스(TTS/STT)를 자동화하고 싶을 때",
        "work_utility": "영상·오디오 제작 외주 비용을 낮추고, 음성 온보딩이나 실시간 요약 같은 차별화 UX로 이어져요.",
        "practical_tip": "30초 내외 짧은 제품 소개 스크립트 하나로 음질·자연스러움·생성 비용을 먼저 테스트해 보세요.",
    },
    "research": {
        "when_needed": "차세대 모델 구조, 추론 최적화, 평가 벤치마크 흐름을 먼저 읽고 기술 로드맵을 세워야 할 때",
        "work_utility": "조만간 상용화될 핵심 기법을 미리 파악해 서비스 아키텍처가 금방 구식이 되지 않게 설계 방향을 잡아요.",
        "practical_tip": "논문 전체를 읽기 전에 초록의 핵심 수치와 공개 코드(GitHub) 유무부터 확인해 작은 PoC 가능성을 따져 보세요.",
    },
    "industry": {
        "when_needed": "모델 가격 변화, API 정책, 빅테크 투자·파트너십 흐름에 맞춰 서비스 원가와 벤더 전략을 점검할 때",
        "work_utility": "특정 공급사 종속 리스크를 줄이고, 시장 수요가 몰리는 영역을 포착해 다음 제품 기획에 바로 반영해요.",
        "practical_tip": "현재 서비스의 월간 API 비용 구조와 대체 모델 전환 난이도를 한 페이지 표로 점검해 두세요.",
    },
    "social": {
        "when_needed": "글로벌 AI 빌더·인디해커들이 막 출시한 신서비스·데모·실전 팁을 가장 빠르게 포착하고 싶을 때",
        "work_utility": "대형 언론보다 먼저 뜨는 신규 제품 아이디어와 실제 사용자 호평·불만 포인트를 서비스 기획에 바로 반영해요.",
        "practical_tip": "원문 스레드와 댓글에서 사람들이 가장 많이 요청하는 기능이나 불편 지점을 메모해 기획 아이디어를 뽑아 보세요.",
    },
}

CATEGORY_BENCHMARK_FALLBACK: dict[str, str] = {
    "llm_chat": "대화형 UX·응답 정확도·토큰 단가 개선 포인트",
    "dev": "개발자 워크플로 자동화·에이전트 통합 생산성",
    "image_design": "시각 생성 품질·일관성·편집 제어력",
    "video_audio": "멀티모달 생성 자연스러움·실시간 처리 속도",
    "research": "모델 효율·추론 성능·오픈 벤치마크 진전",
    "industry": "AI 생태계 가격·정책·시장 재편 시그널",
    "social": "글로벌 빌더의 실시간 런칭·커뮤니티 초기 반응",
}


def is_blocked_noise(title: str, body: str = "", url: str = "") -> bool:
    """독서 모임 모집·채용·단순 모객 홍보글·말웨어 레포 차단."""
    hay = f"{title} {body[:400]} {url}"
    return any(p.search(hay) for p in BLOCKED_NOISE_PATTERNS)


def is_anecdote_chatter(text: str) -> bool:
    """도입부 개인 일화·잡담·인사말 문장인지 판별."""
    if not text:
        return False
    return bool(ANECDOTE_INTRO_RE.search(text))


def _title_keywords(title_ko: str, original_title: str = "") -> set[str]:
    """제목에서 핵심 기술·주제어 토큰 추출 (불용어 제외)."""
    combined = f"{title_ko} {original_title}"
    tokens: set[str] = set()
    for tok in TOKEN_RE.findall(combined):
        low = tok.lower().strip("._-")
        if len(low) < 2 or low in STOPWORDS:
            continue
        # 한국어 조사 단순 제거 (예: '클로드로' -> '클로드')
        if re.match(r"^[가-힣]{3,}$", low):
            for suffix in ("으로", "에서", "에게", "까지", "부터", "처럼", "보다", "하고", "이면", "하면", "은", "는", "이", "가", "을", "를", "의", "도", "로", "와", "과"):
                if low.endswith(suffix) and len(low) - len(suffix) >= 2:
                    tokens.add(low[: -len(suffix)])
                    break
        tokens.add(low)
    return tokens


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []
    # 연속 공백을 줄바꿈은 보존하면서 정리
    normalized = re.sub(r"[ \t]+", " ", text).strip()
    raw_parts = SENTENCE_SPLIT_RE.split(normalized)
    out: list[str] = []
    for part in raw_parts:
        s = re.sub(r"\s+", " ", part).strip(" -•·|")
        if len(s) >= 14:
            out.append(s)
    return out


def extract_relevant_core_sentences(
    title_ko: str,
    original_title: str,
    body_ko: str,
    *,
    max_sentences: int = 2,
    max_chars: int = 230,
) -> str:
    """제목 핵심어와 의미적 겹침이 높은 본문 핵심/결론 문장만 선별 (서두 개인 일화·잡담 완전 배제)."""
    sentences = _split_sentences(body_ko)
    if not sentences:
        return ""
    keywords = _title_keywords(title_ko, original_title)
    title_low = title_ko.lower().strip()

    scored: list[tuple[float, int, str]] = []
    total = len(sentences)
    for idx, sent in enumerate(sentences):
        low = sent.lower()
        if low == title_low:
            continue
        score = 0.0
        # 1) 제목 핵심어 겹침 (가장 강력한 신호)
        kw_hits = sum(1 for kw in keywords if kw in low)
        score += kw_hits * 4.0
        # 2) AI/기술/도구 실체 키워드
        tech_hits = len(TECH_SIGNAL_RE.findall(sent))
        score += min(3, tech_hits) * 1.8
        # 3) 수치·버전·지표 보너스
        if METRIC_PHRASE_RE.search(sent):
            score += 1.6
        # 4) 결론/요약/기능 설명 문장 보너스
        if CONCLUSION_SIGNAL_RE.search(sent):
            score += 1.2
        # 5) 개인 일화·잡담·인사말 강력 감점 (예: "로이킴 팬이 되어 콘서트를...")
        if ANECDOTE_INTRO_RE.search(sent):
            score -= 8.0
        # 6) 본문이 길 때 맨 첫 문장이 제목 키워드 0개면 도입부 잡담일 가능성 높음 → 감점
        if idx == 0 and total >= 3 and kw_hits == 0 and tech_hits == 0:
            score -= 4.0
        # 지나치게 짧은 감탄문/단편 감점
        if len(sent) < 24:
            score -= 1.5
        scored.append((score, idx, sent))

    # 양수 점수(실제 주제 관련 문장)만 채택; 전부 개인 잡담이면 빈 문자열 반환해 안전 폴백
    qualified = [item for item in scored if item[0] >= 1.5]
    if not qualified:
        return ""

    top = sorted(qualified, key=lambda x: (x[0], -x[1]), reverse=True)[:max_sentences]
    # 읽는 흐름이 자연스럽도록 본문 등장 순서대로 재정렬
    top.sort(key=lambda x: x[1])
    picked = " ".join(s for _, _, s in top)
    if len(picked) > max_chars:
        cut = picked[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:-")
        picked = f"{cut}…"
    return picked


def _first_sentences(text: str, max_sentences: int = 2, max_chars: int = 200) -> str:
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if not clean:
        return ""
    parts = [p.strip() for p in SENTENCE_SPLIT_RE.split(clean) if p.strip()]
    picked = " ".join(parts[:max_sentences]) if parts else clean
    if len(picked) > max_chars:
        cut = picked[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:-")
        picked = f"{cut}…"
    return picked


def _wrap_key_phrase(sentence: str) -> str:
    """형광펜 마커(==...==)가 없으면 핵심 수치·버전 또는 핵심 구절 1곳에 자동 부여."""
    if not sentence or "==" in sentence:
        return sentence
    m = METRIC_PHRASE_RE.search(sentence)
    if m:
        s, e = m.span()
        return f"{sentence[:s]}=={sentence[s:e]}=={sentence[e:]}"
    words = sentence.split()
    if len(words) >= 4:
        chunk = " ".join(words[: min(5, len(words))])
        if len(chunk) <= 38:
            return sentence.replace(chunk, f"=={chunk}==", 1)
    return sentence


def polish_korean_headline(
    title_ko: str,
    original_title: str = "",
    *,
    platform_id: str = "",
    author_handle: Optional[str] = None,
    category: str = "industry",
    metrics: Optional[dict[str, Any]] = None,
) -> str:
    """직역투·잘린 @핸들 접두사·기계적 말투를 정돈해 클릭을 부르는 자연스러운 한국어 뉴스룸 헤드라인으로 다듬는다."""
    metrics = metrics or {}
    t = re.sub(r"\s+", " ", (title_ko or original_title or "")).strip()
    if not t:
        return ""

    # X 포스트는 출처 배지에 @핸들이 이미 선명히 뜨므로 제목 앞 중복 '@handle: ' 제거
    if platform_id == "x":
        t = re.sub(r"^@[A-Za-z0-9_]{1,20}:\s*", "", t).strip()

    # 어색한 직역 어미 다듬기
    t = re.sub(r"\s*최신\s*소식$", "", t).strip()
    t = re.sub(r"이야기\.$", "이유", t).strip()
    t = re.sub(r"하는\s*방법$", "실전 가이드", t).strip()

    # GitHub 급상승/릴리즈 헤드라인 정돈
    if metrics.get("feed") == "github_trending" and metrics.get("stars"):
        stars = metrics["stars"]
        if "스타" not in t and "★" not in t:
            t = f"{t} (GitHub ★{stars})"
    elif metrics.get("feed") == "github_release":
        if not re.search(r"[가-힣]", t):
            t = f"{t} 새 정식 버전 릴리즈"

    # 고유명사/버전명 위주라 한글 비중이 여전히 낮으면 문맥에 맞는 자연스러운 한국어 서술을 부여
    hangul_cnt = len(re.findall(r"[가-힣]", t))
    if hangul_cnt < 3:
        cat_suffix = {
            "llm_chat": "새 AI 모델·기능 업데이트",
            "dev": "개발자 도구·오픈소스 공개",
            "image_design": "AI 이미지·디자인 모델 공개",
            "video_audio": "AI 영상·음성 모델 업데이트",
            "research": "신규 AI 연구·벤치마크 발표",
            "industry": "글로벌 AI 업계 주요 발표",
            "social": "글로벌 AI 빌더 실시간 공유",
        }.get(category, "AI 주요 업데이트")
        if platform_id == "x" and author_handle:
            t = f"{author_handle}, {t} 공개"
        else:
            t = f"{t} — {cat_suffix}"

    if len(t) > 78:
        t = t[:77].rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"
    return t


def _synthesize_unique_what(
    *,
    title_ko: str,
    platform_id: str,
    platform_name: str,
    category: str,
    lead_subject: str,
    author_handle: str,
    metrics: dict[str, Any],
) -> str:
    """RSS 본문이 짧아도 복붙 템플릿 없이 기사별 고유한 핵심 요약 1~2문장을 생성한다."""
    feed_kind = str(metrics.get("feed") or "")
    stars = metrics.get("stars")
    velocity = metrics.get("star_velocity")
    metric_hit = METRIC_PHRASE_RE.search(title_ko)
    metric_note = f" 특히 =={metric_hit.group(0)}== 수치가 핵심 포인트로 꼽혀요." if metric_hit else ""

    if feed_kind == "github_trending" and stars:
        return f"{title_ko} 프로젝트가 공개 72시간 안에 스타 =={stars}개==(+{velocity or 1}/시간)를 돌파하며 오픈소스 개발자들의 주목을 받고 있어요."
    if feed_kind == "github_release":
        return f"{lead_subject}의 {title_ko} 정식 배포가 이뤄져 안정화 패치와 신규 기능을 바로 프로젝트에 적용할 수 있어요."
    if platform_id == "x":
        who = author_handle or lead_subject
        return f"{who}가 X에서 직접 공유한 '{title_ko}' 업데이트예요.{metric_note} 실사용 데모와 빌더 스레드 반응이 빠르게 이어지고 있어요."

    by_cat = {
        "llm_chat": f"{platform_name}가 '{title_ko}'를 공개하며 대화형 AI의 실사용 품질과 작업 효율을 한 단계 끌어올렸어요.{metric_note}",
        "dev": f"{lead_subject} 개발 생태계에서 '{title_ko}' 구현 방식과 실전 적용 사례가 공개됐어요.{metric_note}",
        "image_design": f"{platform_name}에 '{title_ko}' 이미지·디자인 모델/워크플로가 올라와 시각 제작 파이프라인에 바로 시험해 볼 수 있어요.{metric_note}",
        "video_audio": f"{platform_name}에서 '{title_ko}' 멀티모달 영상·음성 활용법이 공개돼 제작 자동화 가능성을 넓혔어요.{metric_note}",
        "research": f"{platform_name}가 '{title_ko}' 연구 결과를 발표해 차세대 모델 성능과 추론 효율의 새 기준을 제시했어요.{metric_note}",
        "industry": f"{platform_name}가 전한 '{title_ko}' 이슈로 글로벌 AI 시장·서비스 전략의 방향 변화가 뚜렷해졌어요.{metric_note}",
        "social": f"{platform_name} 커뮤니티에서 '{title_ko}'를 둘러싼 현업 개발자·빌더들의 실전 검증과 논의가 활발해요.{metric_note}",
    }
    return by_cat.get(category, by_cat["industry"])
def _detect_signal_type(category: str, platform_id: str, feed_kind: str, title: str, body: str) -> str:
    hay = f"{title} {body[:400]}".lower()
    if feed_kind in ("github_trending", "github_release") or platform_id == "github":
        return "open_source_trend"
    if platform_id == "x" or feed_kind == "x_oembed":
        if any(k in hay for k in ("launch", "ship", "demo", "built", "출시", "공개", "런칭")):
            return "new_product"
        return "builder_signal"
    if any(k in hay for k in ("release", "v0.", "v1.", "v2.", "gpt-", "claude", "gemini", "qwen", "deepseek", "llama", "출시", "버전")):
        return "model_release"
    if category == "research":
        return "research_breakthrough"
    if category == "dev":
        return "dev_workflow"
    if category == "industry":
        return "industry_shift"
    return "new_product"


def build_curated_fields(
    *,
    title_ko: str,
    original_title: str,
    body_ko: str,
    raw_body: str,
    platform_id: str,
    platform_name: str,
    category: str,
    cat_label: str,
    seen_platforms: list[str],
    metrics: Optional[dict[str, Any]] = None,
    entities: Optional[list[dict[str, Any]]] = None,
    benefit_tag: Optional[str] = None,
    llm_why: str = "",
) -> dict[str, Any]:
    """제목 핵심어 기반 1분 압축 브리핑 + 형광펜 핵심 결론 + 실전 효용 + AI 기획팀 메타 생성."""
    metrics = metrics or {}
    entities = entities or []
    feed_kind = str(metrics.get("feed") or "")
    author_handle = str(metrics.get("author_handle") or "").strip()
    stars = metrics.get("stars")
    velocity = metrics.get("star_velocity")
    repo_slug = str(metrics.get("repo") or "").strip()
    release_tag = str(metrics.get("release_tag") or "").strip()

    multi_note = f" (총 {len(seen_platforms)}개 출처 동시 포착)" if len(seen_platforms) > 1 else ""
    entity_names = [str(e.get("name")) for e in entities if isinstance(e, dict) and e.get("name")]
    lead_subject = entity_names[0] if entity_names else platform_name

    # 1) context_ko (원래는요 — 1줄 압축 배경)
    if platform_id == "x" or feed_kind == "x_oembed":
        who = f"{author_handle}" if author_handle else "글로벌 AI 빌더"
        context_ko = f"𝕏 실시간 타임라인의 {who}가 공개한 {cat_label} 최신 시그널이에요{multi_note}."
    elif feed_kind == "github_trending":
        star_txt = f" (72시간 내 ★{stars}, +{velocity}/h)" if stars and velocity else ""
        context_ko = f"GitHub에서 급상승 중인 신규 AI 오픈소스 {repo_slug or lead_subject}{star_txt}예요{multi_note}."
    elif feed_kind == "github_release":
        tag_txt = f" {release_tag}" if release_tag else ""
        context_ko = f"{repo_slug or platform_name}의 새 정식 릴리즈{tag_txt}가 GitHub에 배포됐어요{multi_note}."
    else:
        context_ko = f"{platform_name}에서 공개된 {cat_label} 분야 핵심 소식이에요{multi_note}."

    # 2) what_ko (무슨 일이냐면요 — 복붙 템플릿 0%, 제목 핵심어 기반 핵심 문장 추출 또는 기사별 고유 요약)
    core_excerpt = extract_relevant_core_sentences(title_ko, original_title, body_ko, max_sentences=2, max_chars=210)
    if core_excerpt and core_excerpt.lower() != title_ko.lower():
        if feed_kind == "github_trending" and stars:
            what_ko = f"{core_excerpt} 공개 직후 스타 =={stars}개==를 빠르게 넘겼어요."
        elif feed_kind == "github_release":
            what_ko = f"핵심 변경점: {core_excerpt}"
        else:
            what_ko = core_excerpt
    else:
        what_ko = _synthesize_unique_what(
            title_ko=title_ko,
            platform_id=platform_id,
            platform_name=platform_name,
            category=category,
            lead_subject=lead_subject,
            author_handle=author_handle,
            metrics=metrics,
        )

    # 3) why_ko (왜 중요할까요? — 1~2문장 압축)
    if llm_why and not is_anecdote_chatter(llm_why):
        why_ko = _first_sentences(llm_why, max_sentences=2, max_chars=180)
    elif feed_kind == "github_trending":
        why_ko = "공개 직후 스타가 빠르게 붙는 프로젝트는 실무 개발자의 당면 문제를 직접 푼 도구인 경우가 많아 사내 자동화·기획 참고 가치가 커요."
    elif feed_kind == "github_release":
        why_ko = "정식 릴리즈에는 안정화 패치와 실무 신기능이 반영돼 기존 에이전트 스택 업그레이드 시점을 판단하는 기준이 돼요."
    elif platform_id == "x":
        why_ko = "공식 보도자료보다 X에서 데모·런칭이 먼저 공개되는 경우가 많아 초기 반응과 신기능 아이디어를 한발 앞서 잡을 수 있어요."
    else:
        cat_why_map = {
            "llm_chat": "대화형 AI의 응답 품질·토큰 단가 선택에 직접 연결되는 변화라 기존 도구와 비교해 두면 실무 효율이 빨라져요.",
            "dev": "코딩 에이전트와 개발 워크플로 생산성에 바로 영향을 주는 변화라 도입 여부를 빠르게 가늠해 볼 가치가 커요.",
            "image_design": "시각 자산 제작 속도와 품질 일관성을 높이는 흐름이라 디자인·마케팅 자동화 파이프라인에 바로 참고할 수 있어요.",
            "video_audio": "영상·음성 제작 비용과 작업 시간을 줄이는 멀티모달 변화라 실제 데모 품질과 요금 조건을 먼저 살펴볼 만해요.",
            "research": "조만간 상용 모델과 개발 도구에 흡수될 핵심 기법이라 실험 수치와 한계를 미리 짚어 두면 기술 로드맵에 도움돼요.",
            "industry": "AI 가격·정책·생태계 지형을 바꾸는 업계 시그널이라 벤더 전략과 서비스 원가 점검의 기준점이 돼요.",
            "social": "현업 AI 개발자·빌더가 지금 가장 주목하는 실전 사례라 댓글 반응과 한계점까지 함께 보면 기획 통찰이 선명해져요.",
        }
        why_ko = cat_why_map.get(category, cat_why_map["industry"])

    # 4) highlight_summary (핵심 한 줄 결론 카드 — 1~2문장 + 형광펜)
    core_line = _first_sentences(what_ko, max_sentences=1, max_chars=140)
    if not core_line or len(core_line) < 18:
        core_line = title_ko
    core_line = _wrap_key_phrase(core_line)
    if benefit_tag and benefit_tag not in core_line:
        highlight_summary = f"{core_line} 핵심 이득은 =={benefit_tag}==이에요."
    else:
        why_short = _first_sentences(why_ko, max_sentences=1, max_chars=95)
        highlight_summary = f"{core_line} {why_short}".strip()

    # 5) utility_tip (실전 활용 & 벤치마킹 카드)
    base_util = CATEGORY_UTILITY.get(category, CATEGORY_UTILITY["industry"])
    if feed_kind == "github_trending":
        utility_tip = {
            "when_needed": f"{lead_subject} 같은 급상승 오픈소스를 발굴해 개발·자동화 시간을 줄이고 싶을 때",
            "work_utility": f"검증된 커뮤니티 반응(★{stars or '급상승'})을 바탕으로 바닥부터 구현하지 않고 프로토타입·사내 도구로 응용할 수 있어요.",
            "practical_tip": "README 빠른 시작(Quick Start)과 라이선스(MIT/Apache 등)를 확인한 뒤 로컬에서 10분 테스트해 보세요.",
        }
    elif platform_id == "x":
        utility_tip = {
            "when_needed": f"{author_handle or lead_subject}처럼 최전선 AI 빌더의 신기능·서비스 런칭을 빠르게 캐치할 때",
            "work_utility": "신규 AI 웹·앱의 문제 해결 방식과 초기 데모 UX를 벤치마킹해 우리 서비스 기획안에 바로 녹여낼 수 있어요.",
            "practical_tip": "원문 데모 링크와 댓글 피드백에서 '사용자가 열광한 핵심 기능 1가지'를 메모해 기획 소재로 써 보세요.",
        }
    else:
        utility_tip = {
            "when_needed": base_util["when_needed"],
            "work_utility": base_util["work_utility"],
            "practical_tip": base_util["practical_tip"],
        }

    # 6) planning_meta (하위 AI 기획팀 에이전트용 구조화 시그널)
    signal_type = _detect_signal_type(category, platform_id, feed_kind, f"{title_ko} {original_title}", f"{body_ko} {raw_body}")
    product_domain = CATEGORY_DOMAIN_MAP.get(category, "ai-business-infra")
    metric_hit = METRIC_PHRASE_RE.search(f"{title_ko} {what_ko}")
    if benefit_tag:
        benchmark_point = benefit_tag
    elif metric_hit:
        benchmark_point = f"{lead_subject} — {metric_hit.group(0)} 기반 성능·효율 지표"
    elif feed_kind == "github_trending" and stars:
        benchmark_point = f"72시간 내 GitHub {stars}스타(+{velocity}/h) 돌파"
    else:
        benchmark_point = CATEGORY_BENCHMARK_FALLBACK.get(category, "신규 AI 기능 및 시장 변화")

    actionable_idea = (
        f"{lead_subject}의 '{benchmark_point}' 요소를 참고해, "
        f"우리 {product_domain} 영역 서비스의 핵심 워크플로 자동화 또는 차별화 기능 MVP로 검증"
    )

    planning_meta = {
        "signal_type": signal_type,
        "product_domain": product_domain,
        "benchmark_point": benchmark_point,
        "actionable_idea": actionable_idea,
    }

    return {
        "context_ko": context_ko,
        "what_ko": what_ko,
        "why_ko": why_ko,
        "highlight_summary": highlight_summary,
        "utility_tip": utility_tip,
        "planning_meta": planning_meta,
    }
