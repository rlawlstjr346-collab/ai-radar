import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_FEED } from "@/data/sample-feed";
import { loadRadarData } from "@/lib/data";
import { formatLastCollected, hotFeed, hotRankScore, interleaveMaxConsecutive, pickSpotlight } from "@/lib/filter";
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

  it("실시간 레이더는 매체 점수보다 무조건 최신 published_at 내림차순을 최우선으로 하고 3연속 동일 출처만 미세 인터리빙한다", () => {
    const now = Date.parse("2026-11-24T04:00:00Z");
    const mk = (id: string, platform_id: string, minsAgo: number, score: number): FeedItem => ({
      ...SAMPLE_FEED[0],
      id: `live-${id}`,
      platform_id,
      canonical_url: `https://example.net/${id}`,
      importance_score: score,
      published_at: new Date(now - minsAgo * 60_000).toISOString(),
      created_at: new Date(now - minsAgo * 60_000).toISOString(),
      lifecycle_status: "hot",
    });

    const olderHigh = mk("verge-old", "the-verge-ai", 240, 48); // 4시간 전 초고점수
    const newest = mk("v2ex-10m", "v2ex", 10, 22); // 10분 전
    const q1 = mk("qb-15m", "qbitai", 15, 25);
    const q2 = mk("qb-20m", "qbitai", 20, 25);
    const q3 = mk("qb-25m", "qbitai", 25, 25);
    const j1 = mk("jj-30m", "juejin", 30, 24);
    const stale50h = mk("stale-50h", "anthropic", 50 * 60, 49); // 48시간 초과

    const ranked = hotFeed([olderHigh, stale50h, q3, j1, q2, q1, newest], "all", now);
    expect(ranked[0].id).toBe("live-v2ex-10m");
    expect(ranked[ranked.length - 1].id).toBe("live-stale-50h");
    // 3연속 동일 출처(qbitai) 방지 확인
    const interleaved = interleaveMaxConsecutive([q1, q2, q3, j1], 2);
    expect(interleaved.map((x) => x.platform_id)).toEqual(["qbitai", "qbitai", "juejin", "qbitai"]);
  });
});
