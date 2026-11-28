import { describe, expect, it } from "vitest";

import { SAMPLE_FEED } from "@/data/sample-feed";
import { coerceEnrichment } from "@/lib/enrichment";
import { buildFrontPage, hasVerifiedPublishTime, WIRE_COUNT, WIRE_MAX_PER_SOURCE } from "@/lib/front-page";
import { BUILTIN_TERMS, itemTerms, tooltipTerms } from "@/lib/glossary";
import { splitByTerms } from "@/lib/terms";
import type { FeedItem } from "@/lib/types";

const NOW = Date.parse("2026-11-28T09:00:00Z");
const H = 3_600_000;

function mk(id: string, hoursAgo: number, extra: Partial<FeedItem> = {}): FeedItem {
  const iso = new Date(NOW - hoursAgo * H).toISOString();
  return {
    ...SAMPLE_FEED[0], id, canonical_url: `https://news.site.kr/${id}`, published_at: iso, created_at: iso,
    fetched_at: new Date(NOW - hoursAgo * H + 60_000).toISOString(), relatedArticles: undefined, related_refs: [],
    cluster_size: 1, source_count: 1, importance_score: 10, image_url: null, ...extra,
  };
}

describe("내장 AI 핵심 용어 사전 + 기사별 glossary 병합", () => {
  it("60개 이상, 중복 없이, 요청한 핵심 용어를 모두 담는다", () => {
    expect(BUILTIN_TERMS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BUILTIN_TERMS.map((t) => t.term.toLowerCase())).size).toBe(BUILTIN_TERMS.length);
    const names = new Set(BUILTIN_TERMS.map((t) => t.term));
    for (const t of ["MCP", "GGUF", "SDK", "RAG", "LLM", "양자화", "지식 증류", "파인튜닝", "컨텍스트 윈도우", "벤치마크", "오픈웨이트", "추론 모델", "에이전트 하네스"]) {
      expect(names.has(t), t).toBe(true);
    }
    for (const t of BUILTIN_TERMS) expect(t.easy.trim().endsWith("요."), t.term).toBe(true);
  });

  it("기사별 terms → glossary → 내장 사전 순으로, 같은 단어는 기사 풀이가 이긴다", () => {
    const item = { terms: [{ term: "MCP", easy: "기사 워커 풀이예요." }], glossary: [{ term: "mcp", easy: "중복" }, { term: "Inkling", easy: "기사 모델 풀이예요." }] };
    expect(itemTerms(item).map((t) => t.easy)).toEqual(["기사 워커 풀이예요.", "기사 모델 풀이예요."]);
    const all = tooltipTerms(item);
    expect(all.filter((t) => t.term.toLowerCase() === "mcp")).toHaveLength(1);
    expect(all.some((t) => t.term === "GGUF")).toBe(true);
  });

  it("문단당 같은 용어는 첫 1회만, 영문 약어는 다른 단어 속에서 잡지 않는다", () => {
    const segs = splitByTerms("MCP 서버와 MCP 클라이언트, storage 와 RAG 검색", tooltipTerms({ terms: [] }));
    expect(segs.filter((s) => s.term).map((s) => s.text)).toEqual(["MCP", "RAG"]);
    expect(splitByTerms("지식 증류로 만든 작은 모델", tooltipTerms({ terms: [] })).find((s) => s.term)?.text).toBe("지식 증류");
  });

  it("live-feed glossary [{term, desc}] 를 화면용 Term 으로 읽고, 없으면 키를 만들지 않는다", () => {
    expect(coerceEnrichment({ glossary: [{ term: "MCP", desc: "표준 플러그예요." }, { term: "", desc: "x" }] }).glossary).toEqual([{ term: "MCP", easy: "표준 플러그예요." }]);
    expect("glossary" in coerceEnrichment({})).toBe(false);
  });
});

describe("우측 최신 속보 — 발행 시각 검증 + 출처 다양성", () => {
  it("발행 시각을 모르는 기사(published_at == fetched_at)는 검증 안 됨", () => {
    const t = "2026-11-28T08:00:00.000Z";
    expect(hasVerifiedPublishTime({ published_at: t, fetched_at: t })).toBe(false);
    expect(hasVerifiedPublishTime({ published_at: null, fetched_at: t })).toBe(false);
    expect(hasVerifiedPublishTime({ published_at: "2026-11-28T07:00:00Z", fetched_at: t })).toBe(true);
  });

  it("상위 6칸은 검증된 기사만 최신순, 같은 출처는 최대 2건", () => {
    const hf = Array.from({ length: 5 }, (_, i) => {
      const iso = new Date(NOW - (0.1 + i * 0.01) * H).toISOString();
      return mk(`hf-${i}`, 0.1 + i * 0.01, { platform_id: "huggingface", published_at: iso, fetched_at: iso });
    });
    const verge = Array.from({ length: 4 }, (_, i) => mk(`verge-${i}`, 0.5 + i * 0.1, { platform_id: "the-verge-ai" }));
    const others = ["openai", "anthropic", "the-decoder", "aitimes"].map((p, i) => mk(`o-${p}`, 1 + i, { platform_id: p }));
    const hero = mk("hero", 0.05, { platform_id: "google-ai", image_url: "https://img.site.kr/h.jpg" });
    const layout = buildFrontPage([hero, ...hf, ...verge, ...others], NOW);
    expect(layout.wire).toHaveLength(WIRE_COUNT);
    expect(layout.wire.every(hasVerifiedPublishTime)).toBe(true);
    expect(layout.wire.some((i) => i.platform_id === "huggingface")).toBe(false);
    const counts = new Map<string, number>();
    for (const i of layout.wire) counts.set(i.platform_id, (counts.get(i.platform_id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(WIRE_MAX_PER_SOURCE);
    const times = layout.wire.map((i) => Date.parse(i.published_at!));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // 와이어에서 빠진 기사도 스트림에 그대로 남는다
    expect(layout.stream.map((i) => i.id)).toEqual(expect.arrayContaining(["hf-0", "verge-2", "verge-3"]));
  });
});
