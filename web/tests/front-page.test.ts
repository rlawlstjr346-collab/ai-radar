import { describe, expect, it } from "vitest";

import { SAMPLE_FEED } from "@/data/sample-feed";
import { buildFrontPage, photoSlotScore, plainSummary } from "@/lib/front-page";
import type { FeedItem } from "@/lib/types";

const NOW = Date.parse("2026-11-28T09:00:00Z");
const H = 3_600_000;

function mk(id: string, hoursAgo: number, extra: Partial<FeedItem> = {}): FeedItem {
  const iso = new Date(NOW - hoursAgo * H).toISOString();
  return { ...SAMPLE_FEED[0], id, canonical_url: `https://news.site.kr/${id}`, published_at: iso, created_at: iso, relatedArticles: undefined, related_refs: [], cluster_size: 1, source_count: 1, importance_score: 10, image_url: `https://img.site.kr/${id}.jpg`, ...extra };
}

describe("1면 포토 슬롯 신선도 가드레일", () => {
  it("4일 전 대형 묶음 기사가 30시간 이내 기사들을 제치고 히어로·좌측 포토를 차지하지 못한다", () => {
    const old = mk("old-cluster", 96, { cluster_size: 5, importance_score: 40 });
    const fresh = Array.from({ length: 12 }, (_, i) => mk(`fresh-${i}`, 1 + i * 2));
    const layout = buildFrontPage([old, ...fresh], NOW);
    const top = [layout.hero!, ...layout.side].map((i) => i.id);
    expect(top).not.toContain("old-cluster");
    for (const i of [layout.hero!, ...layout.side]) expect(NOW - Date.parse(i.published_at!)).toBeLessThanOrEqual(30 * H);
    expect(photoSlotScore(old, NOW)).toBeLessThan(photoSlotScore(fresh[0], NOW));
  });

  it("30시간 이내 기사가 부족하면 48시간 → 전체로 넓혀 빈 칸 없이 채운다", () => {
    const items = [40, 41, 42, 43, 44, 45, 46, 47, 70, 100].map((h, i) => mk(`w${i}`, h));
    const layout = buildFrontPage(items, NOW);
    expect(layout.hero).not.toBeNull();
    expect(layout.side).toHaveLength(2);
    expect(NOW - Date.parse(layout.hero!.published_at!)).toBeLessThanOrEqual(48 * H);
  });

  it("정제 요약이 빈 문자열이면 상투구 폴백 없이 비워 둔다", () => {
    expect(plainSummary(mk("x", 1, { easy_summary_ko: "", what_ko: "템플릿 문장이에요." }))).toBe("");
  });
});
