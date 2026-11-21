import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_FEED } from "@/data/sample-feed";
import { loadRadarData } from "@/lib/data";
import { formatLastCollected, hotFeed, hotRankScore, pickSpotlight } from "@/lib/filter";
import type { FeedItem } from "@/lib/types";

describe("실제 원문 발행 시각 유지 + 최신 live-feed 1면 우선 정렬", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sampleData 는 Date.now() 로 샘플 기사 시간을 20분 전·45분 전으로 덮어쓰지 않고 실제 published_at 을 유지한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const data = await loadRadarData();
    const gemini = data.items.find((i) => i.id === "sample-gemini-4-neon");
    const sampleRef = SAMPLE_FEED.find((i) => i.id === "sample-gemini-4-neon")!;
    expect(gemini).toBeDefined();
    expect(gemini!.created_at).toBe(sampleRef.published_at);
    expect(gemini!.published_at).toBe(sampleRef.published_at);
  });

  it("최근 24~48시간 이내 수집된 live-* 기사가 정적 sample-* 기사보다 1면 상단·스포트라이트에 우선 노출된다", () => {
    const now = Date.parse("2026-11-21T02:00:00Z");
    const sampleItem: FeedItem = {
      ...SAMPLE_FEED[0],
      id: "sample-older-high",
      importance_score: 40,
      published_at: "2026-11-19T12:00:00Z",
      created_at: "2026-11-19T12:00:00Z",
      lifecycle_status: "hot",
      easy_original_ready: true,
    };
    const liveFresh: FeedItem = {
      ...SAMPLE_FEED[0],
      id: "live-fresh-1",
      canonical_url: "https://openai.com/index/live-fresh-1",
      importance_score: 26,
      published_at: "2026-11-21T00:30:00Z",
      created_at: "2026-11-21T00:30:00Z",
      lifecycle_status: "hot",
      easy_original_ready: true,
    };
    const live24h: FeedItem = {
      ...SAMPLE_FEED[0],
      id: "live-24h-1",
      canonical_url: "https://deepmind.google/blog/live-24h-1",
      importance_score: 26,
      published_at: "2026-11-20T06:00:00Z",
      created_at: "2026-11-20T06:00:00Z",
      lifecycle_status: "hot",
      easy_original_ready: true,
    };
    const liveUndated: FeedItem = {
      ...SAMPLE_FEED[0],
      id: "live-undated-1",
      canonical_url: "https://example.net/undated",
      importance_score: 30,
      published_at: null,
      fetched_at: "2026-11-21T01:55:00Z",
      created_at: "2026-11-21T01:55:00Z",
      lifecycle_status: "hot",
      easy_original_ready: true,
    };

    expect(hotRankScore(liveFresh, now)).toBeGreaterThan(hotRankScore(sampleItem, now));
    expect(hotRankScore(live24h, now)).toBeGreaterThan(hotRankScore(sampleItem, now));
    expect(hotRankScore(liveFresh, now)).toBeGreaterThan(hotRankScore(liveUndated, now));

    const ranked = hotFeed([sampleItem, liveUndated, live24h, liveFresh], "all", now);
    expect(ranked[0].id).toBe("live-fresh-1");
    expect(ranked[1].id).toBe("live-24h-1");
    expect(pickSpotlight(ranked, 2).map((i) => i.id)).toEqual(["live-fresh-1", "live-24h-1"]);
  });

  it("formatLastCollected 는 마지막 자동 수집 시각을 N분 전 또는 KST HH:MM 으로 깔끔하게 표시한다", () => {
    const now = Date.parse("2026-11-21T02:00:00Z"); // 11:00 KST
    expect(formatLastCollected("2026-11-21T01:59:40Z", now)).toBe("방금 전");
    expect(formatLastCollected("2026-11-21T01:45:00Z", now)).toBe("15분 전");
    expect(formatLastCollected("2026-11-21T00:05:00Z", now)).toBe("09:05");
    expect(formatLastCollected("2026-11-19T00:05:00Z", now)).toBe("11.19 09:05");
    expect(formatLastCollected(null, now)).toBeNull();
  });
});
