import { stripHighlightMarks } from "./highlight";
import type { Category, FeedItem, PlanningMeta, UtilityTip } from "./types";

const METRIC_RE =
  /(?:\$?\d[\d,]*(?:\.\d+)?\s?(?:%|퍼센트|배|달러|센트|원(?!래)|위(?![가-힣])|점(?![가-힣])|만\s?(?:명|건|개|원|달러|토큰)|억|조|ms|초|시간|스타)|v\d+\.\d+(?:\.\d+)?)/;

const CATEGORY_UTILITY: Record<Category, UtilityTip> = {
  llm_chat: {
    when_needed: "문서 요약·고객 응대·리서치 자동화처럼 대화형 AI의 품질과 비용 효율을 동시에 높여야 할 때 필요해요.",
    work_utility: "웹·앱 안의 AI 비서 응답 정확도를 높이거나, 모델 전환만으로 토큰 원가와 응답 지연을 줄이는 기준이 돼요.",
    practical_tip: "자주 쓰는 사내 프롬프트 3~5개를 같은 입력으로 돌려 품질·속도·비용을 기존 모델과 나란히 비교해 보세요.",
  },
  dev: {
    when_needed: "코딩 에이전트, 자동화 파이프라인, MCP·SDK 연동으로 개발과 배포 속도를 끌어올리고 싶을 때 필요해요.",
    work_utility: "반복 구현 시간을 크게 줄이고, AI 기능을 기존 백엔드·프런트엔드 구조에 안전하게 붙이는 실무 레퍼런스가 돼요.",
    practical_tip: "작은 실험 브랜치나 단일 API 엔드포인트에 먼저 붙여 빌드·에러 처리 흐름부터 가볍게 검증해 보세요.",
  },
  image_design: {
    when_needed: "랜딩 페이지 비주얼, 썸네일, UI 시안, 제품 컷을 적은 리소스로 빠르게 제작해야 할 때 필요해요.",
    work_utility: "디자인 시안 반복 주기를 단축하고, 일관된 톤의 시각 자산을 자동 생성하는 제작 파이프라인으로 확장할 수 있어요.",
    practical_tip: "브랜드 컬러와 구도 조건을 고정 템플릿으로 두고 시안 4~8장을 한 번에 뽑아 가장 깔끔한 컷을 골라 보세요.",
  },
  video_audio: {
    when_needed: "제품 데모 영상, 숏폼 마케팅, 다국어 더빙·음성 인터페이스를 빠르게 구현해야 할 때 필요해요.",
    work_utility: "영상·오디오 제작 외주 비용을 줄이고, 음성 온보딩이나 실시간 요약 같은 차별화 UX 기능으로 연결할 수 있어요.",
    practical_tip: "30초 내외 짧은 제품 소개 스크립트 하나로 자연스러움·지연 시간·생성 단가를 먼저 시험해 보세요.",
  },
  research: {
    when_needed: "차세대 모델 구조, 추론 최적화, 평가 벤치마크의 방향을 먼저 읽고 기술 로드맵을 세워야 할 때 필요해요.",
    work_utility: "곧 상용 도구에 흡수될 핵심 기법을 미리 파악해 서비스 아키텍처가 빠르게 낡지 않도록 설계 기준을 잡을 수 있어요.",
    practical_tip: "논문 전문보다 초록의 핵심 수치와 공개 코드(GitHub) 유무부터 확인해 작은 PoC 가능성을 따져 보세요.",
  },
  industry: {
    when_needed: "모델 가격 변동, API 정책, 빅테크 투자·파트너십 흐름에 맞춰 원가와 벤더 전략을 점검할 때 필요해요.",
    work_utility: "특정 공급사 종속 리스크를 낮추고, 시장 수요가 몰리는 영역을 포착해 다음 제품 기획에 반영할 수 있어요.",
    practical_tip: "현재 서비스의 월간 API 비용 구조와 대체 모델 전환 난이도를 한 페이지 표로 정리해 두세요.",
  },
  social: {
    when_needed: "글로벌 AI 빌더·인디해커들이 막 공개한 신규 서비스·데모·실전 활용 팁을 가장 먼저 포착하고 싶을 때 필요해요.",
    work_utility: "대형 언론보다 앞서 뜨는 신규 제품 아이디어와 실제 사용자 호평·불만 포인트를 서비스 기획에 바로 녹여낼 수 있어요.",
    practical_tip: "원문 스레드와 댓글에서 사람들이 가장 많이 요구하는 기능이나 아쉬운 점을 1줄 메모로 남겨 기획 소재로 써 보세요.",
  },
};

const CATEGORY_DOMAIN: Record<Category, string> = {
  llm_chat: "chatbot-productivity",
  dev: "coding-agent-devtool",
  image_design: "image-design-studio",
  video_audio: "video-audio-media",
  research: "ai-research-model",
  industry: "ai-business-infra",
  social: "builder-community-signal",
};

function firstSentence(text?: string | null, maxChars = 155): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^.+?[.!?요다](?=\s|$)/);
  const picked = (m ? m[0] : clean).trim();
  if (picked.length <= maxChars) return picked;
  return `${picked.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[,;:-]+$/, "")}…`;
}

function wrapWithHighlightMark(sentence: string): string {
  if (!sentence || /==[^=\n]+==/.test(sentence)) return sentence;
  const hit = METRIC_RE.exec(sentence);
  if (hit && hit.index !== undefined) {
    return `${sentence.slice(0, hit.index)}==${hit[0]}==${sentence.slice(hit.index + hit[0].length)}`;
  }
  const words = sentence.split(/\s+/);
  if (words.length >= 4) {
    const span = words.slice(0, Math.min(5, words.length)).join(" ");
    if (span.length <= 36) return sentence.replace(span, `==${span}==`);
  }
  return `==${sentence.slice(0, Math.min(34, sentence.length))}==${sentence.slice(Math.min(34, sentence.length))}`;
}

/**
 * 우측 패널 상단 '형광펜 핵심 요약' (1~2문장).
 * live-feed.json 에 미리 생성된 highlight_summary 가 있으면 그대로 쓰고,
 * 기존 저장 기사·샘플 기사에서도 핵심 1~2문장을 자동 추출해 형광펜을 입힌다.
 */
export function getHighlightSummary(item: FeedItem): string {
  if (item.highlight_summary?.trim()) {
    return wrapWithHighlightMark(item.highlight_summary.trim());
  }
  const lead = firstSentence(item.what_ko, 150) || item.hook_title;
  const markedLead = wrapWithHighlightMark(lead);
  if (item.benefit_tag?.trim() && !stripHighlightMarks(markedLead).includes(item.benefit_tag.trim())) {
    return `${markedLead} 핵심 이득은 ==${item.benefit_tag.trim()}==이에요.`;
  }
  const why = firstSentence(item.why_ko, 110);
  if (why && stripHighlightMarks(why) !== stripHighlightMarks(markedLead)) {
    return `${markedLead} ${why}`;
  }
  return markedLead;
}

/**
 * 우측 패널 '어디에 써먹을까요? · 실전 효용 & 활용 팁'.
 * 미리 큐레이션된 utility_tip 이 있으면 우선 사용하고, 없으면 기사 메타로 즉시 맞춤 생성한다.
 */
export function getUtilityInsight(item: FeedItem, platformName?: string): UtilityTip {
  if (item.utility_tip?.when_needed && item.utility_tip?.work_utility && item.utility_tip?.practical_tip) {
    return item.utility_tip;
  }
  const base = CATEGORY_UTILITY[item.category] ?? CATEGORY_UTILITY.industry;
  const subject = item.entities[0]?.name || platformName || item.platform_id;
  if (item.platform_id === "x") {
    return {
      when_needed: `${item.author_handle ?? subject}처럼 글로벌 AI 빌더의 신규 런칭·데모 시그널을 남들보다 빠르게 캐치할 때 필요해요.`,
      work_utility: base.work_utility,
      practical_tip: base.practical_tip,
    };
  }
  if (item.benefit_tag?.trim()) {
    return {
      when_needed: base.when_needed,
      work_utility: `'${item.benefit_tag.trim()}' 이점을 활용해 ${base.work_utility}`,
      practical_tip: base.practical_tip,
    };
  }
  return base;
}

/** 하위 AI 기획팀 에이전트용 planning_meta (미존재 시 결정론적 폴백 생성) */
export function getPlanningMeta(item: FeedItem, platformName?: string): PlanningMeta {
  if (item.planning_meta?.signal_type && item.planning_meta?.product_domain) {
    return item.planning_meta;
  }
  const subject = item.entities[0]?.name || platformName || item.platform_id;
  const domain = CATEGORY_DOMAIN[item.category] ?? "ai-business-infra";
  const signal_type =
    item.platform_id === "github"
      ? "open_source_trend"
      : item.platform_id === "x"
        ? "builder_signal"
        : item.category === "research"
          ? "research_breakthrough"
          : item.category === "dev"
            ? "dev_workflow"
            : item.category === "industry"
              ? "industry_shift"
              : "new_product";
  const benchmark_point =
    item.benefit_tag?.trim() ||
    firstSentence(stripHighlightMarks(item.what_ko ?? ""), 70) ||
    item.hook_title;
  const actionable_idea = `${subject}의 '${benchmark_point}' 포인트를 참고해 ${domain} 영역 제품 기능이나 워크플로 자동화 MVP로 검증`;
  return {
    signal_type,
    product_domain: domain,
    benchmark_point,
    actionable_idea,
  };
}
