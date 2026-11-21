import type { Category, Difficulty, EasyOriginal, Entity, Term } from "./types";

/**
 * [원본 쉽게 읽기] 결정론적 합성기 — 외부 호출·AI 키 없이 어디서나 돌아간다 (서버·브라우저 공용).
 *
 * 원문 전문 해설(손으로 쓴 샘플, DB 캐시, LLM 생성)이 없거나 만들 수 없을 때의 마지막 단계.
 * 이미 검증해 둔 그 기사의 요약 필드(원래는요 / 무슨 일이냐면요 / 비유 / 왜 중요할까요 / 참고할 점 / 용어)만으로
 * 원문 흐름(배경 → 핵심 → 의미 → 주의)에 맞춘 완독 가이드를 만든다. 요약에 없는 사실은 하나도 더하지 않는다.
 * X·Bluesky 단문은 3단(원문 해독 → 화제가 된 맥락 → 실전 활용 포인트)으로 구성한다.
 * source_note 에 '요약을 바탕으로 정리했다'고 밝혀, 원문 전문 해설인 척하지 않는다.
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

export const SYNTH_MODEL = "ai-radar summary synthesizer v1";
export const SYNTH_NOTE =
  "원문 전문 해설 대신, AI 레이더가 검증한 요약을 원문 흐름(배경 → 핵심 → 의미 → 주의)에 맞춰 다시 정리했어요. 정확한 표현과 세부 수치는 원문 링크에서 확인하세요.";

const SHORT_POST_PLATFORMS = new Set(["x", "bluesky"]);
const clean = (s?: string | null) => (s ?? "").trim();
const join = (...parts: Array<string | null | undefined>) => parts.map(clean).filter(Boolean).join(" ");

/** 원문 페이지에서 먼저 볼 곳 — 카테고리·출처 성격에 맞춘 안내 (특정 그림·표 번호처럼 확인 안 된 사실은 쓰지 않는다) */
function watchPoints(x: SynthInput, shortPost: boolean): string[] {
  const firstEntity = x.entities?.[0]?.name;
  const points: string[] = [];
  if (shortPost) {
    points.push("원 게시물 아래 답글과 인용 게시물을 보면 다른 개발자들이 어떻게 받아들였는지 바로 알 수 있어요.");
    points.push("게시물에 첨부된 이미지·영상이나 링크가 있다면 그쪽에 원래 근거(벤치마크 표, 데모)가 있어요.");
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
    if (firstEntity) points.push(`원문에서 '${firstEntity}'가 처음 나오는 부분부터 읽으면 이 소식의 핵심으로 바로 들어갈 수 있어요.`);
  }
  if (x.caveats_ko) points.push("위 '읽을 때 주의할 점'에 적은 조건이 원문 어디에 쓰여 있는지 한 번 찾아보세요.");
  return points.slice(0, 3);
}

export function synthesizeEasyOriginal(x: SynthInput, generatedAt: string | null = null): EasyOriginal {
  const shortPost = SHORT_POST_PLATFORMS.has(x.platform_id);
  const terms = (x.terms ?? []).filter((t) => t.term && t.easy);
  const termLine = terms.length ? terms.map((t) => `'${t.term}'은(는) ${t.easy}`).join(" ") : "";
  const sections: EasyOriginal["sections"] = [];

  if (shortPost) {
    sections.push({
      heading: "1. 핵심 포스트 원문 해독",
      body: join(x.what_ko, x.benefit_tag ? `한 줄로 줄이면 '${x.benefit_tag}'예요.` : null) || x.hook_title,
      quote: null,
    });
    sections.push({
      heading: "2. 왜 개발자들 사이에서 화제인가",
      body: join(x.context_ko, x.analogy_ko) || join(x.why_ko) || x.hook_title,
      quote: null,
    });
    sections.push({
      heading: "3. 실전 활용 포인트",
      body: join(x.why_ko, x.caveats_ko ? `다만 ${x.caveats_ko}` : null, termLine) || x.hook_title,
      quote: null,
    });
  } else {
    sections.push({ heading: "배경: 원래는 이랬어요", body: clean(x.context_ko) || x.hook_title, quote: null });
    sections.push({
      heading: "핵심: 무슨 일이 있었나요",
      body: join(x.what_ko, x.benefit_tag ? `독자에게 생기는 이득을 한 줄로 줄이면 '${x.benefit_tag}'예요.` : null) || x.hook_title,
      quote: null,
    });
    if (clean(x.analogy_ko)) sections.push({ heading: "쉽게 비유하면", body: clean(x.analogy_ko), quote: null });
    sections.push({ heading: "의미: 그래서 나에게 뭐가 달라지나요", body: clean(x.why_ko) || x.hook_title, quote: null });
    if (clean(x.caveats_ko) || termLine) {
      sections.push({ heading: "읽을 때 주의할 점과 알아 둘 용어", body: join(x.caveats_ko, termLine), quote: null });
    }
  }

  return {
    sections: sections.filter((s) => s.body.trim().length > 0),
    watch_points: watchPoints(x, shortPost),
    source_note: SYNTH_NOTE,
    generated_at: generatedAt,
    model: SYNTH_MODEL,
  };
}
