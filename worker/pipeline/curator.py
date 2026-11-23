"""웹 고유 AI 큐레이터 — 노이즈 차단 + 자연스러운 한국어 요약 + 형광펜 핵심 요약 + 실전 효용 + 기획팀 메타.

원칙:
- '...에 관한 소식이에요' 같은 기계적 복붙 문구 금지
- [독서 모임 모집], 채용, 수강생/참가자 모집 등 모객·홍보성 글 원천 차단
- LLM 키가 없는 0원 환경이나 한도 초과 시에도 원문의 수치·버전·기능·도메인 신호를 바탕으로
  자연스러운 한국어 요약, 형광펜 핵심 요약(highlight_summary), 실전 효용 팁(utility_tip),
  하위 AI 기획팀 에이전트용 planning_meta 를 결정론적으로 구조화한다.
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

METRIC_PHRASE_RE = re.compile(
    r"(?:\$?\d[\d,]*(?:\.\d+)?\s?(?:%|퍼센트|배|달러|센트|원|위|점|만|억|조|ms|초|시간|stars?|스타|K|M|B)|v\d+\.\d+(?:\.\d+)?)",
    re.I,
)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?다요])\s+")

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
        "when_needed": "문서 요약·고객 응대·리서치 자동화처럼 대화형 AI의 정확도와 비용 효율을 함께 높여야 할 때 필요해요.",
        "work_utility": "웹·앱 내 AI 비서 기능의 응답 품질을 높이거나, 모델 교체만으로 토큰 비용과 대기 시간을 줄이는 기준점이 돼요.",
        "practical_tip": "자주 쓰는 사내 프롬프트 3~5개를 동일 입력으로 돌려 응답 품질·속도·가격을 기존 모델과 나란히 비교해 보세요.",
    },
    "dev": {
        "when_needed": "코딩 에이전트, 자동화 파이프라인, MCP/SDK 연동으로 개발·배포 속도를 끌어올리고 싶을 때 필요해요.",
        "work_utility": "보일러플레이트 구현 시간을 줄이고, AI 기능을 기존 백엔드·프런트엔드 아키텍처에 안전하게 붙이는 실무 레퍼런스가 돼요.",
        "practical_tip": "작은 사이드 브랜치나 테스트용 엔드포인트 하나에 먼저 붙여 빌드·에러 처리 흐름부터 검증해 보세요.",
    },
    "image_design": {
        "when_needed": "랜딩 페이지 비주얼, 썸네일, UI 시안, 제품 컷을 적은 인력으로 빠르게 대량 제작해야 할 때 필요해요.",
        "work_utility": "디자인 시안 반복 주기를 크게 단축하고, 일관된 브랜드 톤의 시각 자산을 자동 생성하는 파이프라인으로 확장할 수 있어요.",
        "practical_tip": "브랜드 컬러·구도 가이드를 고정 프롬프트 템플릿으로 저장해 두고, 4~8개 시안을 한 번에 뽑아 비교해 보세요.",
    },
    "video_audio": {
        "when_needed": "제품 데모 영상, 숏폼 마케팅, 다국어 더빙·음성 인터페이스(TTS/STT)를 빠르게 구현해야 할 때 필요해요.",
        "work_utility": "영상·오디오 제작 외주 비용을 낮추고, 음성 기반 온보딩이나 실시간 요약 기능 같은 신규 UX 차별화 포인트로 이어져요.",
        "practical_tip": "30초 내외 짧은 제품 소개 스크립트 하나로 음질·자연스러움·생성 비용을 먼저 테스트해 보세요.",
    },
    "research": {
        "when_needed": "차세대 모델 구조, 추론 최적화, 평가 벤치마크의 흐름을 먼저 읽고 기술 로드맵을 세워야 할 때 필요해요.",
        "work_utility": "6개월 뒤 상용화될 핵심 기법을 미리 파악해 제품 구조가 금방 구식이 되지 않도록 설계 방향을 잡는 데 도움돼요.",
        "practical_tip": "논문 전체를 읽기 전에 초록의 핵심 수치와 공개 코드(GitHub) 유무부터 확인해 작은 PoC 가능성을 따져 보세요.",
    },
    "industry": {
        "when_needed": "모델 가격 변화, API 정책, 빅테크 투자·파트너십 흐름에 맞춰 서비스 원가와 벤더 전략을 점검할 때 필요해요.",
        "work_utility": "특정 공급사 종속 리스크를 줄이고, 시장에서 빠르게 커지는 수요 영역을 포착해 다음 제품 기획에 반영할 수 있어요.",
        "practical_tip": "현재 서비스의 월간 API 비용 구조와 대체 모델 전환 난이도를 한 페이지 표로 점검해 두세요.",
    },
    "social": {
        "when_needed": "글로벌 AI 빌더와 인디해커들이 지금 막 출시한 신서비스·데모·실전 팁을 가장 빠르게 포착하고 싶을 때 필요해요.",
        "work_utility": "대형 언론보다 먼저 뜨는 신규 제품 아이디어와 실제 사용자 반응(불만·호평 포인트)을 서비스 기획에 바로 반영할 수 있어요.",
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
    """독서 모임 모집·채용·단순 모객 홍보글인지 검사."""
    hay = f"{title} {body[:400]} {url}"
    return any(p.search(hay) for p in BLOCKED_NOISE_PATTERNS)


def _first_sentences(text: str, max_sentences: int = 2, max_chars: int = 240) -> str:
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
    # 수치 없으면 첫 절(최대 32자)을 자연스럽게 하이라이트
    words = sentence.split()
    if len(words) >= 4:
        chunk = " ".join(words[: min(5, len(words))])
        if len(chunk) <= 38:
            return sentence.replace(chunk, f"=={chunk}==", 1)
    return sentence


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
    """자연스러운 한국어 4단 요약 + 형광펜 핵심 요약 + 실전 효용 팁 + AI 기획팀 메타를 생성한다."""
    metrics = metrics or {}
    entities = entities or []
    feed_kind = str(metrics.get("feed") or "")
    author_handle = str(metrics.get("author_handle") or "").strip()
    stars = metrics.get("stars")
    velocity = metrics.get("star_velocity")
    repo_slug = str(metrics.get("repo") or "").strip()
    release_tag = str(metrics.get("release_tag") or "").strip()

    multi_note = f" (총 {len(seen_platforms)}개 글로벌 출처에서 동시 포착)" if len(seen_platforms) > 1 else ""
    entity_names = [str(e.get("name")) for e in entities if isinstance(e, dict) and e.get("name")]
    lead_subject = entity_names[0] if entity_names else platform_name

    # 1) context_ko (배경)
    if platform_id == "x" or feed_kind == "x_oembed":
        who = f"{author_handle} 계정" if author_handle else "글로벌 AI 빌더 계정"
        context_ko = f"𝕏 실시간 타임라인의 {who}에서 포착된 최신 AI 소식이에요{multi_note}."
    elif feed_kind == "github_trending":
        star_txt = f" (최근 72시간 내 스타 {stars}개, 시간당 +{velocity}개 속도)" if stars and velocity else ""
        context_ko = f"GitHub에서 급상승 중인 신규 AI 오픈소스 {repo_slug or lead_subject} 프로젝트예요{star_txt}{multi_note}."
    elif feed_kind == "github_release":
        tag_txt = f" {release_tag}" if release_tag else ""
        context_ko = f"{repo_slug or platform_name} 오픈소스의 신규 정식 릴리즈{tag_txt}가 GitHub에 공개됐어요{multi_note}."
    else:
        context_ko = f"{platform_name}에서 새로 올라온 {cat_label} 분야 핵심 업데이트예요{multi_note}."

    # 2) what_ko (무슨 일이냐면요 — 기계적 '...에 관한 소식이에요' 완전 제거!)
    excerpt = _first_sentences(body_ko, max_sentences=3, max_chars=320)
    if excerpt and excerpt.lower() != title_ko.lower():
        if feed_kind == "github_trending" and stars:
            what_ko = f"{excerpt} 공개 직후 개발자 관심이 몰리며 스타 =={stars}개==를 빠르게 넘겼어요."
        elif feed_kind == "github_release":
            what_ko = f"이번 새 버전의 핵심 변경점은 다음과 같아요. {excerpt}"
        elif platform_id == "x":
            what_ko = f"{excerpt}"
        else:
            what_ko = f"{excerpt}"
    else:
        if feed_kind == "github_trending" and stars:
            what_ko = f"{title_ko} — 최근 72시간 안에 공개돼 시간당 ==+{velocity or 1}스타== 속도로 주목받는 신규 AI 오픈소스 프로젝트예요."
        elif feed_kind == "github_release":
            what_ko = f"{title_ko} 정식 버전이 배포됐어요. 변경 내역(Changelog)과 설치·업그레이드 가이드는 원문 릴리즈 노트에서 바로 확인할 수 있어요."
        elif platform_id == "x":
            what_ko = f"{author_handle or '글로벌 AI 빌더'}가 '{title_ko}' 내용을 실시간으로 공유했어요. 데모 화면과 스레드 댓글 반응은 원문 링크에서 바로 볼 수 있어요."
        else:
            what_ko = f"{platform_name}가 '{title_ko}' 내용을 공식 발표했어요. 세부 기능 사양과 적용 예시는 원문에서 바로 살펴볼 수 있어요."

    # 3) why_ko (왜 중요할까요?)
    if llm_why:
        why_ko = llm_why
    elif feed_kind == "github_trending":
        why_ko = "공개 직후 스타가 빠르게 붙는 레포는 실무 개발자들이 지금 당장 겪는 불편을 푼 도구인 경우가 많아요. 오픈소스 구조를 훑어두면 유사 기능 기획이나 사내 자동화에 바로 참고할 수 있어요."
    elif feed_kind == "github_release":
        why_ko = "정식 릴리즈에는 안정화 패치와 바로 써먹을 신규 기능이 담겨 있어요. 기존 워크플로나 운영 중인 에이전트 스택에 업그레이드할 가치가 있는지 빠르게 판단해 보세요."
    elif platform_id == "x":
        why_ko = "공식 블로그보다 X에서 데모·런칭 소식이 먼저 공개되는 경우가 많아요. 초기 사용자 반응과 실전 활용 사례를 한발 앞서 포착해 제품 기획에 참고할 수 있어요."
    else:
        cat_why_map = {
            "llm_chat": "일상 업무와 AI 비서 선택에 직접 연결되는 변화예요. 응답 품질과 비용·사용량 조건을 기존 도구와 비교해 두면 실무 선택이 훨씬 빨라져요.",
            "dev": "개발 생산성과 코딩 에이전트 파이프라인에 바로 연결되는 실무 변화예요. 코드 예시와 호환성 변화를 확인해 두면 프로젝트 적용 시 시행착오를 줄일 수 있어요.",
            "image_design": "시각 콘텐츠 제작 속도와 결과물 일관성을 끌어올리는 흐름이에요. 생성 샘플과 상업적 라이선스 조건을 함께 확인해 두면 바로 업무에 활용할 수 있어요.",
            "video_audio": "영상·음성 제작 비용과 제작 시간을 크게 줄이는 멀티모달 흐름이에요. 실제 데모 결과물의 자연스러움과 요금 체계를 먼저 살펴보세요.",
            "research": "조만간 상용 모델과 개발 도구에 흡수될 핵심 기법이에요. 실험 수치와 한계점을 미리 짚어 두면 다음 분기 기술 방향을 읽는 데 큰 도움이 돼요.",
            "industry": "AI 서비스 가격·정책·생태계 지형에 영향을 주는 업계 시그널이에요. 발표된 수치와 적용 시점을 파악해 두면 벤더 선택과 기획 판단이 선명해져요.",
            "social": "실제 AI 개발자·빌더 커뮤니티가 지금 가장 뜨겁게 반응하는 이슈예요. 원문 스레드에서 실사용 후기와 한계 지적까지 함께 확인해 보세요.",
        }
        why_ko = cat_why_map.get(category, cat_why_map["industry"])

    # 4) highlight_summary (형광펜 핵심 요약 1~2문장)
    core_line = _first_sentences(what_ko, max_sentences=1, max_chars=155)
    if not core_line or len(core_line) < 20:
        core_line = title_ko
    core_line = _wrap_key_phrase(core_line)
    if benefit_tag and benefit_tag not in core_line:
        highlight_summary = f"{core_line} 핵심 이득은 =={benefit_tag}==이에요."
    else:
        why_short = _first_sentences(why_ko, max_sentences=1, max_chars=105)
        highlight_summary = f"{core_line} {why_short}".strip()

    # 5) utility_tip (어디에 써먹을까요? · 실전 효용 & 활용 팁)
    base_util = CATEGORY_UTILITY.get(category, CATEGORY_UTILITY["industry"])
    if feed_kind == "github_trending":
        utility_tip = {
            "when_needed": f"{lead_subject} 같은 최신 오픈소스 도구를 빠르게 발굴해 개발·자동화 시간을 줄이고 싶을 때 필요해요.",
            "work_utility": f"검증된 커뮤니티 반응({stars or '급상승'}스타)을 바탕으로 직접 바닥부터 구현하지 않고 프로토타입·사내 도구로 즉시 응용할 수 있어요.",
            "practical_tip": "레포의 README 빠른 시작(Quick Start)과 라이선스(MIT/Apache 등)를 먼저 확인한 뒤 로컬 환경에서 10분 테스트해 보세요.",
        }
    elif platform_id == "x":
        utility_tip = {
            "when_needed": f"{author_handle or lead_subject}처럼 최전선 AI 빌더의 신기능·서비스 런칭을 남들보다 빠르게 캐치해야 할 때 필요해요.",
            "work_utility": "신규 AI 웹·앱의 문제 해결 방식과 초기 데모 UX를 벤치마킹해 우리 서비스 기획안·랜딩 포인트에 바로 녹여낼 수 있어요.",
            "practical_tip": "원문 포스트의 데모 링크와 댓글 피드백을 2분만 훑어 '사람들이 열광한 핵심 기능 1가지'를 기획 메모로 남겨 두세요.",
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
        benchmark_point = f"72시간 내 GitHub {stars}스타(시간당 +{velocity}) 돌파"
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
