import { describe, expect, it } from "vitest";

import { SAMPLE_EASY_ORIGINAL } from "@/data/sample-easy-original";
import { SAMPLE_FEED } from "@/data/sample-feed";
import { autoHighlights, entityHighlights, highlightSegments, MAX_ENTITY_CHIPS, MAX_HIGHLIGHTS, parseHighlightMarks, stripHighlightMarks } from "@/lib/highlight";
import type { Entity, Term } from "@/lib/types";

const hl = (text: string, terms: Term[] = [], entities: Entity[] = []) =>
  highlightSegments(text, terms, true, entities)
    .filter((s) => s.hl)
    .map((s) => s.text);

const ent = (text: string, terms: Term[] = [], entities: Entity[] = []) =>
  highlightSegments(text, terms, true, entities)
    .filter((s) => s.entity)
    .map((s) => s.text);

describe("형광펜 마커 ==…==", () => {
  it("마커를 걷어내고 구간을 기록한다", () => {
    expect(parseHighlightMarks("비용이 ==32% 낮아졌대요== 정말요")).toEqual({
      text: "비용이 32% 낮아졌대요 정말요",
      ranges: [{ start: 4, end: 13 }],
    });
    expect(stripHighlightMarks("a ==b== c")).toBe("a b c");
  });

  it("마커가 있으면 자동 감지보다 우선한다", () => {
    expect(hl("가격은 3달러예요. ==제일 싸요==")).toEqual(["제일 싸요"]);
  });
});

describe("자동 감지 (마커 없는 문단)", () => {
  it("퍼센트·배수·금액·순위·점수를 잡는다", () => {
    const t = "비용 32% 절감, 1.97배 빨라짐, 입력 100만 토큰당 3달러, 주당 83달러, 전체 3위, 61점";
    const ranges = autoHighlights(t, [], 10).map((r) => t.slice(r.start, r.end));
    expect(ranges).toEqual(["32%", "1.97배", "100만 토큰", "3달러", "주당 83달러", "전체 3위", "61점"]);
  });

  it("단위 없는 숫자·날짜·모델명 숫자는 잡지 않는다", () => {
    expect(hl("Gemini 4 모델이 11월 19일에 나왔어요")).toEqual([]);
  });

  it("작은따옴표 개념 구절(2~22자)을 잡되 영어 소유격은 무시한다", () => {
    expect(hl("구글은 '깊게 생각하면서도 빠르고 싸게'를 내세웠어요")).toEqual(["깊게 생각하면서도 빠르고 싸게"]);
    expect(hl("Google's model and Meta's model")).toEqual([]);
  });

  it("문단당 최대 3곳", () => {
    expect(hl("1% 2% 3% 4% 5%")).toHaveLength(MAX_HIGHLIGHTS);
  });

  it("용어 툴팁 구간과 겹치면 용어(점선)가 이긴다", () => {
    const terms = [{ term: "32% 할인", easy: "" }] as Term[];
    const segs = highlightSegments("이번에 32% 할인 그리고 2배", terms);
    expect(segs.find((s) => s.term)?.text).toBe("32% 할인");
    expect(segs.filter((s) => s.hl).map((s) => s.text)).toEqual(["2배"]);
  });

  it("조각을 이어 붙이면 마커를 뺀 원문과 같다", () => {
    const text = "==핵심== 구절과 MIT 라이선스, 그리고 40%";
    const terms = [{ term: "MIT 라이선스", easy: "" }] as Term[];
    expect(highlightSegments(text, terms).map((s) => s.text).join("")).toBe(stripHighlightMarks(text));
  });

  it("기존 샘플 요약·완독 본문에서도 바로 밑줄이 보인다", () => {
    const summaryHits = SAMPLE_FEED.filter((i) => [i.context_ko, i.what_ko, i.why_ko].some((t) => t && hl(t, i.terms).length > 0));
    expect(summaryHits.length).toBeGreaterThan(5);
    const easyHits = Object.values(SAMPLE_EASY_ORIGINAL).filter((e) => e.sections.some((s) => hl(s.body).length > 0));
    expect(easyHits.length).toBeGreaterThan(3);
  });
});

describe("듀얼 하이라이트: AI 모델명·주요 인물명 인디고 칩", () => {
  it("모델명과 인물명을 감지하고, 긴 이름 우선 + 동일 고유명사는 문단 첫 등장만 칩으로 표시한다", () => {
    const text = "Gemini 4 Neon은 Carbon보다 32% 싸요. 샘 올트먼과 Andrej Karpathy도 주목했고, Gemini 4 Neon은 다시 언급됐어요.";
    expect(hl(text)).toEqual(["32%"]);
    expect(ent(text)).toEqual(["Gemini 4 Neon", "Carbon", "샘 올트먼", "Andrej Karpathy"]);
    expect(highlightSegments(text, []).map((s) => s.text).join("")).toBe(text);
  });

  it("기사의 entities 항목(모델·인물·도구)도 동적으로 감지한다", () => {
    const entities: Entity[] = [{ name: "Tideway MoE", kind: "model", tags: ["moe"] }];
    expect(ent("새 오픈소스 모델 Tideway MoE가 추론 속도를 2배 높였어요.", [], entities)).toEqual(["Tideway MoE"]);
  });

  it("용어 툴팁(점선) > 형광펜 밑줄 > 인디고 칩 우선순위로 겹치지 않는다", () => {
    const terms: Term[] = [{ term: "Gemini", easy: "구글 AI 모델" }];
    const segs = highlightSegments("Gemini와 ==Claude 32%== 그리고 DeepSeek, vLLM", terms);
    expect(segs.find((s) => s.term)?.text).toBe("Gemini");
    expect(segs.filter((s) => s.hl).map((s) => s.text)).toEqual(["Claude 32%"]);
    expect(segs.filter((s) => s.entity).map((s) => s.text)).toEqual(["DeepSeek", "vLLM"]);
  });

  it("문단당 인디고 칩 상한(MAX_ENTITY_CHIPS)을 지킨다", () => {
    const text = "GPT-6, Claude, Gemini, DeepSeek, Qwen, Llama, EXAONE, HyperCLOVA X";
    expect(entityHighlights(text)).toHaveLength(MAX_ENTITY_CHIPS);
  });
});
