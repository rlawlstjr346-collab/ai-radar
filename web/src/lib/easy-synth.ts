import type { Category, Difficulty, EasyOriginal, Entity, Term } from "./types";

/**
 * [원본 쉽게 읽기] 결정론적 합성기 — 외부 호출·AI 키 없이 어디서나 돌아간다 (서버·브라우저 공용).
 *
 * 1분 핵심 요약보다 항상 풍성하고 깊이 있는(최소 2배 이상 분량) 매거진 완독 가이드를 구성한다.
 * X·Bluesky 단문은 기존 계약대로 3단(원문 해독 → 화제 맥락 → 실전 활용 포인트)을 유지하되 각 문단을 충실히 풀어 쓴다.
 */

export interface SynthInput {
  platform_id: string;
  category: Category;
  hook_title: string;
  benefit_tag?: string | null;
  context_ko?: string | null;
  what_ko?: string | null;
  analogy_ko?: string | null;
  why_ko?: string | null;
  caveats_ko?: string | null;
  difficulty: Difficulty;
  terms?: Term[];
  entities?: Entity[];
}

export const SYNTH_MODEL = "ai-radar magazine synthesizer v2";
export const SYNTH_NOTE =
  "원문의 핵심 논지와 배경·세부 의미·용어 해설을 1분 요약보다 훨씬 깊이 있게 풀어 쓴 완독 가이드예요. 정확한 수치와 도표는 하단 원문 링크에서 이어서 볼 수 있어요.";

const SHORT_POST_PLATFORMS = new Set(["x", "bluesky"]);
const clean = (s?: string | null) => (s ?? "").trim();
const join = (...parts: Array<string | null | undefined>) => parts.map(clean).filter(Boolean).join(" ");

const CATEGORY_DEEP_CONTEXT: Record<Category, string> = {
  llm_chat: "대화형 AI와 생산성 도구는 모델 정확도뿐 아니라 응답 속도, 토큰 단가, 긴 문맥 유지력이 실제 체감 품질을 가릅니다. 기존 도구에서 느꼈던 불편이 이번 변화로 얼마나 해소되는지 기준으로 읽어 보면 흐름이 또렷해져요.",
  dev: "코딩 에이전트와 개발 도구는 실제 프로젝트에 붙였을 때의 안정성, 기존 스택과의 호환성, 팀 워크플로 자동화 범위가 핵심입니다. 단순 데모보다 변경 사항(Changelog)과 실무 적용 조건을 함께 살펴보는 것이 좋아요.",
  image_design: "이미지·디자인 생성 도구는 결과물의 미적 완성도뿐 아니라 프롬프트 통제력, 스타일 일관성, 상업적 라이선스 허용 범위가 실무 채택을 좌우해요.",
  video_audio: "영상·음성 멀티모달 AI는 자연스러운 움직임·억양, 실시간 처리 지연 시간, 분당 생성 단가가 실전 활용 가능성을 결정합니다.",
  research: "AI 연구·논문은 당장 내일 제품에 들어가기보다 3~6개월 뒤 상용 모델과 오픈소스 생태계의 표준 기법으로 흡수되는 경우가 많습니다. 제안된 방법의 핵심 가정과 실험 한계를 같이 봐 두면 기술 로드맵을 읽는 눈이 넓어져요.",
  industry: "빅테크와 AI 업계 움직임은 API 가격, 서비스 정책, 투자·파트너십 지형을 통해 결국 개발자와 일반 사용자의 선택지를 바꿉니다. 발표 시점과 실제 적용 대상을 구분해서 읽으면 과장 없이 맥락을 잡을 수 있어요.",
  social: "글로벌 AI 빌더와 연구자 커뮤니티의 실시간 스레드는 공식 블로그보다 한발 먼저 신기능·실사용 후기·문제 제기를 드러냅니다. 본문 주장과 함께 댓글의 반론·보충 사례를 같이 훑으면 입체적으로 이해돼요.",
};

function watchPoints(x: SynthInput, shortPost: boolean): string[] {
  const firstEntity = x.entities?.[0]?.name;
  const points: string[] = [];
  if (shortPost) {
    points.push("원 게시물 아래 답글과 인용 게시물을 보면 다른 개발자·빌더들이 실제로 어떻게 써 보고 평가했는지 바로 확인할 수 있어요.");
    points.push("게시물에 첨부된 데모 영상·이미지·GitHub 링크에 원래 근거(벤치마크 표, 코드 예시)가 담겨 있어요.");
  } else {
    const byCategory: Record<Category, string> = {
      research: "논문이라면 초록(Abstract)과 결론(Conclusion)을 먼저 읽고, 실험 결과 표는 그다음에 보면 덜 막막해요.",
      dev: "개발 문서라면 설치·사용법(Usage) 부분과 변경 사항(Changelog)부터 보면 내 프로젝트에 해당되는지 빨리 알 수 있어요.",
      llm_chat: "서비스 소식이라면 요금·이용 조건과 '어느 지역·요금제부터 열리는지'를 적은 부분을 꼭 확인하세요.",
      image_design: "이미지 도구 소식이라면 원문의 예시 이미지와 프롬프트를 함께 보면 실제 품질을 가늠하기 쉬워요.",
      video_audio: "영상·음성 소식이라면 원문에 걸린 데모 영상이나 샘플 음성을 직접 재생해 보세요.",
      industry: "산업·회사 소식이라면 숫자(금액·비율·날짜)가 나오는 문단을 원문 표현 그대로 확인하세요.",
      social: "커뮤니티 글이라면 댓글에서 실제 사용자들의 반론과 보충 설명을 함께 보세요.",
    };
    points.push(byCategory[x.category]);
    if (firstEntity) points.push(`원문에서 '${firstEntity}'가 처음 나오는 문단부터 읽으면 이 소식의 핵심으로 바로 들어갈 수 있어요.`);
  }
  if (x.caveats_ko) points.push("아래 '읽을 때 주의할 점'에 적은 조건이 원문 어디에 쓰여 있는지 한 번 대조해 보세요.");
  return points.slice(0, 3);
}

export function synthesizeEasyOriginal(x: SynthInput, generatedAt: string | null = null): EasyOriginal {
  const shortPost = SHORT_POST_PLATFORMS.has(x.platform_id);
  const terms = (x.terms ?? []).filter((t) => t.term && t.easy);
  const termLine = terms.length ? terms.map((t) => `'${t.term}'은(는) ${t.easy}`).join(" ") : "";
  const entityNames = (x.entities ?? []).map((e) => e.name).filter(Boolean).slice(0, 4);
  const entityStr = entityNames.length ? entityNames.join(", ") : "관련 AI 도구";
  const deepContext = CATEGORY_DEEP_CONTEXT[x.category] ?? CATEGORY_DEEP_CONTEXT.industry;
  const sections: EasyOriginal["sections"] = [];

  if (shortPost) {
    sections.push({
      heading: "1. 핵심 포스트 원문 해독",
      body: join(
        x.what_ko,
        x.benefit_tag ? `핵심 이득을 한 줄로 줄이면 '${x.benefit_tag}'예요.` : null,
        `원 포스트는 '${x.hook_title}' 주제를 중심으로 ${entityStr} 관련 최신 변화나 실사용 체감을 짧고 직접적으로 공유하고 있어요.`,
      ),
      quote: null,
    });
    sections.push({
      heading: "2. 왜 개발자들 사이에서 화제인가",
      body: join(
        x.context_ko,
        x.analogy_ko,
        deepContext,
        `짧은 스레드 형태지만 현업 빌더들이 당장 겪는 문제와 맞닿아 있어 반응이 빠르게 번지고 있어요.`,
      ),
      quote: null,
    });
    sections.push({
      heading: "3. 실전 활용 포인트",
      body: join(
        x.why_ko,
        `내 프로젝트나 업무에 참고할 때는 ${entityStr}의 실제 적용 조건과 커뮤니티 댓글에서 지적된 한계까지 함께 살펴보는 것이 좋아요.`,
        x.caveats_ko ? `다만 ${x.caveats_ko}` : null,
        termLine,
      ),
      quote: null,
    });
  } else {
    sections.push({
      heading: "배경: 원래는 이랬어요",
      body: join(
        clean(x.context_ko) || x.hook_title,
        deepContext,
        `이번 소식은 '${entityStr}' 흐름 속에서 기존 방식의 제약을 어떻게 풀려는 시도로 나왔는지 이해하면 훨씬 잘 읽혀요.`,
      ),
      quote: null,
    });
    sections.push({
      heading: "핵심: 무슨 일이 있었나요",
      body: join(
        x.what_ko,
        x.benefit_tag ? `독자에게 생기는 핵심 이득을 한 줄로 정리하면 '${x.benefit_tag}'예요.` : null,
        `단순한 헤드라인 이상으로 실제 기능 구성과 기존 대안 대비 어떤 지점이 달라졌는지가 이번 발표의 중심 내용이에요.`,
      ),
      quote: null,
    });
    if (clean(x.analogy_ko)) {
      sections.push({
        heading: "쉽게 비유하면",
        body: join(
          clean(x.analogy_ko),
          `복잡한 기술 용어를 잠시 내려놓고 일상적인 작업 흐름으로 바꿔 생각해 보면, 이 변화가 왜 체감 차이를 만드는지 훨씬 자연스럽게 이해할 수 있어요.`,
        ),
        quote: null,
      });
    }
    sections.push({
      heading: "의미: 그래서 나에게 뭐가 달라지나요",
      body: join(
        clean(x.why_ko) || x.hook_title,
        `실무·기획 관점에서는 '${entityStr}'가 제공하는 장점과 기존에 쓰던 워크플로 사이의 비용·속도·품질 균형을 비교해 보는 것이 핵심이에요. 작은 실험 범위에서 먼저 테스트해 보면 도입 판단이 한결 명확해져요.`,
      ),
      quote: null,
    });
    sections.push({
      heading: "읽을 때 주의할 점과 알아 둘 용어",
      body: join(
        clean(x.caveats_ko) || "세부 수치와 적용 시점, 라이선스·요금 조건은 원문 기준을 꼭 함께 확인하세요.",
        termLine,
        `원문 링크에 들어갔을 때는 본문 중간의 비교 표·예시 코드·지원 환경 안내를 함께 확인하면 오해 없이 실전에 활용할 수 있어요.`,
      ),
      quote: null,
    });
  }

  return {
    sections: sections.filter((s) => s.body.trim().length > 0),
    watch_points: watchPoints(x, shortPost),
    source_note: SYNTH_NOTE,
    generated_at: generatedAt,
    model: SYNTH_MODEL,
  };
}
