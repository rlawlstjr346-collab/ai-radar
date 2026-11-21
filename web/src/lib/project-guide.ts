import { stripHighlightMarks } from "./highlight";
import type { Category, FeedItem } from "./types";

/**
 * [내 프로젝트에 이 기술 써볼까? · 실전 도입 가이드] — 외부 호출 없이 모든 기사에서 즉시 만든다.
 * 그 기사의 카테고리·요약·이득·주의점·난이도·엔티티만 조합하고, 요약에 없는 사실(가격, 성능 수치)은 지어내지 않는다.
 */
export interface ProjectGuide {
  /** ① 이럴 때 바로 써보세요 */
  useWhen: string;
  /** ② 도입 체크포인트 (난이도·비용·주의) */
  checkpoints: Array<{ label: string; text: string }>;
  /** ③ AI 코딩 에이전트에 붙여 넣을 실전 프롬프트 */
  prompt: string;
}

const SCENARIO: Record<Category, string> = {
  llm_chat: "사내 문서 요약, 고객 문의 답변 초안, 반복되는 글쓰기 업무처럼 챗봇·AI 비서를 붙일 곳을 찾고 있을 때",
  dev: "코딩 에이전트·개발 도구를 팀 워크플로에 넣거나, AI 기능을 서비스 코드에 직접 붙이려 할 때",
  image_design: "상세 페이지·썸네일·포스터처럼 이미지 시안을 빠르게 많이 만들어야 할 때",
  video_audio: "짧은 홍보 영상, 더빙·자막, 회의록처럼 영상·음성 작업을 자동화하고 싶을 때",
  research: "새 기법을 우리 데이터로 작게 재현해 보고, 실제 서비스에 넣을 가치가 있는지 판단해야 할 때",
  industry: "도입할 도구·모델·벤더를 고르거나, 팀의 AI 투자 방향을 정해야 할 때",
  social: "커뮤니티에서 화제가 된 사용법을 우리 팀 업무에 바로 따라 해 보고 싶을 때",
};

const DIFFICULTY_CHECK: Record<1 | 2 | 3, string> = {
  1: "원문이 가벼운 소식이라 오늘 바로 시험해 볼 수 있는 수준이에요. 작은 사내 업무 하나에 먼저 붙여 보세요.",
  2: "개발 실무 문서 수준이에요. 개발자 한 명이 반나절~하루 정도 시범 적용해 보고 판단하는 걸 권해요.",
  3: "논문·심화 기술이라 바로 운영에 넣기보다, 작은 실험(PoC)으로 우리 데이터에서도 효과가 나는지 먼저 확인하세요.",
};

const firstSentence = (s?: string | null) => {
  const t = stripHighlightMarks((s ?? "").trim());
  const m = t.match(/^.+?[.!?요다](?=\s|$)/);
  return (m ? m[0] : t).trim();
};

/** 프롬프트의 '핵심 기술' 자리: 엔티티(모델·도구) 우선, 없으면 제목 */
export function guideSubject(item: Pick<FeedItem, "entities" | "hook_title">): string {
  const pick = item.entities.find((e) => /model|tool|technique|platform|product|protocol|feature|format|hardware/.test(e.kind)) ?? item.entities[0];
  return pick?.name ?? item.hook_title;
}

export function buildProjectGuide(item: FeedItem, platformName?: string): ProjectGuide {
  const subject = guideSubject(item);
  const feature = item.benefit_tag?.trim() || firstSentence(item.what_ko) || item.hook_title;
  const why = firstSentence(item.why_ko);

  const useWhen = `${SCENARIO[item.category]} 써 보세요.${why ? ` ${why}` : ""}`;

  const checkpoints = [
    { label: "난이도", text: DIFFICULTY_CHECK[item.difficulty] },
    {
      label: "비용",
      text: item.benefit_tag
        ? `기대 이득은 '${item.benefit_tag}'예요. 실제 요금·사용량 한도는 도입 전에 공식 요금 페이지에서 꼭 확인하세요.`
        : "이 소식엔 비용 수치가 없어요. 유료 API·구독이 필요한지 공식 요금 페이지에서 먼저 확인하세요.",
    },
    {
      label: "주의",
      text: stripHighlightMarks(item.caveats_ko?.trim() || "") || "운영에 넣기 전에 작은 범위로 시험하고, 결과를 사람이 한 번 검토하는 단계를 두세요.",
    },
  ];

  const prompt = [
    `우리 프로젝트에 ${subject}을(를) 도입하려고 해.`,
    `핵심 특징은 "${feature}"이야.`,
    "이 특징을 활용해서 기존 기능을 깨뜨리지 않고 적용할 수 있는 아키텍처와 최소 테스트 코드를 짜줘.",
    "먼저 현재 코드 구조를 읽고, 바꿀 파일 목록과 되돌리는 방법(롤백)도 함께 알려줘.",
    `참고 자료: ${item.canonical_url}${platformName ? ` (${platformName})` : ""}`,
  ].join("\n");

  return { useWhen, checkpoints, prompt };
}
