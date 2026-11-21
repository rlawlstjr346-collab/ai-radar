import { afterEach, describe, expect, it, vi } from "vitest";

import samplePlatforms from "@/data/platforms.sample.json";
import { buildSampleFeed, SAMPLE_FEED, SAMPLE_REFERENCE_TIME } from "@/data/sample-feed";
import { getSupabaseEnv, loadRadarData, normalizeFeedRow } from "@/lib/data";
import { CATEGORY_ORDER } from "@/lib/categories";
import { filterItems, freshness, groupPlatforms, hotFeed, hotRankScore, HOT_LIMIT, isSpotlightEligible, matchesQuery, pastFeed, pickSpotlight, recentForPlatform } from "@/lib/filter";
import { splitByTerms } from "@/lib/terms";
import type { Platform } from "@/lib/types";

describe("splitByTerms", () => {
  it("underlines longest match first and only the first occurrence", () => {
    const segs = splitByTerms("MIT 라이선스라서 MIT 라이선스를 또 언급해요. MIT도요.", [
      { term: "MIT", easy: "a" },
      { term: "MIT 라이선스", easy: "b" },
    ]);
    const terms = segs.filter((s) => s.term).map((s) => [s.text, s.term!.easy]);
    expect(terms).toEqual([
      ["MIT 라이선스", "b"],
      ["MIT", "a"],
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("MIT 라이선스라서 MIT 라이선스를 또 언급해요. MIT도요.");
  });

  it("matches case-insensitively but keeps original casing", () => {
    const segs = splitByTerms("we use lora adapters", [{ term: "LoRA", easy: "x" }]);
    expect(segs.find((s) => s.term)?.text).toBe("lora");
  });

  it("handles empty input and no terms", () => {
    expect(splitByTerms("", [{ term: "x", easy: "y" }])).toEqual([]);
    expect(splitByTerms("hello", [])).toEqual([{ text: "hello" }]);
  });
});

describe("sample data", () => {
  const platforms = samplePlatforms as Platform[];

  it("has all 141 seed platforms (26 base + 115 regional, 52 active + 89 directory_only) across 7 categories", () => {
    expect(platforms).toHaveLength(141);
    expect(platforms.filter((p) => p.collect_status === "active")).toHaveLength(52);
    expect(platforms.filter((p) => p.collect_status === "directory_only")).toHaveLength(89);
    expect(new Set(platforms.map((p) => p.category))).toEqual(new Set(CATEGORY_ORDER));
    // 기존 26곳은 그대로 남아 있다
    for (const id of ["huggingface", "hacker-news", "github", "openai", "anthropic", "google-deepmind", "x", "bluesky", "kling", "elevenlabs"]) {
      expect(platforms.some((p) => p.id === id), id).toBe(true);
    }
  });

  it("covers 6 regions with at least 125 platforms and 32 Korean ones", () => {
    const by = (r: string) => platforms.filter((p) => (p.region ?? "global") === r).length;
    expect(platforms.length).toBeGreaterThanOrEqual(125);
    expect(by("kr")).toBe(32);
    expect(by("jp")).toBeGreaterThanOrEqual(14);
    expect(by("cn")).toBeGreaterThanOrEqual(14);
    expect(by("eu")).toBeGreaterThanOrEqual(12);
    expect(by("social")).toBe(2);
    expect(by("global") + by("kr") + by("jp") + by("cn") + by("eu") + by("social")).toBe(platforms.length);
  });

  it("has 110+ real cards, every category represented, each pointing to a real platform", () => {
    expect(SAMPLE_FEED.length).toBeGreaterThanOrEqual(110);
    expect(SAMPLE_FEED.length).toBeLessThanOrEqual(130);
    for (const c of CATEGORY_ORDER) {
      expect(SAMPLE_FEED.filter((i) => i.category === c).length, c).toBeGreaterThanOrEqual(4);
    }
    const ids = new Set(platforms.map((p) => p.id));
    for (const i of SAMPLE_FEED) expect(ids.has(i.platform_id), i.platform_id).toBe(true);
    expect(new Set(SAMPLE_FEED.map((i) => i.id)).size).toBe(SAMPLE_FEED.length);
    expect(new Set(SAMPLE_FEED.map((i) => i.canonical_url)).size).toBe(SAMPLE_FEED.length);
  });

  it("is a November 2026 snapshot with both hot (0-7d) and warm (8-30d) items", () => {
    const snapshot = Date.parse("2026-11-19T09:00:00Z");
    for (const i of SAMPLE_FEED) {
      expect(i.created_at >= "2026-10-20", i.id).toBe(true);
      const days = (snapshot - Date.parse(i.created_at)) / 86_400_000;
      expect(i.lifecycle_status, i.id).toBe(days <= 7 ? "hot" : "warm");
    }
    expect(SAMPLE_FEED.filter((i) => i.lifecycle_status === "hot").length).toBeGreaterThanOrEqual(85);
    expect(SAMPLE_FEED.filter((i) => i.lifecycle_status === "warm").length).toBeGreaterThanOrEqual(25);
  });

  it("includes 18+ Korean, 14+ Japanese, 10+ Chinese and 12+ X cards from the regional sources", () => {
    const region = new Map((samplePlatforms as Platform[]).map((p) => [p.id, p.region ?? "global"]));
    const count = (r: string) => SAMPLE_FEED.filter((i) => region.get(i.platform_id) === r).length;
    expect(count("kr")).toBeGreaterThanOrEqual(18);
    expect(count("jp")).toBeGreaterThanOrEqual(14);
    expect(count("cn")).toBeGreaterThanOrEqual(10);
    expect(SAMPLE_FEED.filter((i) => i.platform_id === "x").length).toBeGreaterThanOrEqual(12);
  });

  it("every tooltip term actually appears in the card text (so it can be underlined)", () => {
    for (const i of SAMPLE_FEED) {
      const text = [i.context_ko, i.what_ko, i.analogy_ko, i.why_ko, i.caveats_ko].join("\n").toLowerCase();
      for (const t of i.terms) expect(text.includes(t.term.toLowerCase()), `${i.id}: ${t.term}`).toBe(true);
    }
  });

  it("uses no banned hype words", () => {
    const banned = ["혁신적", "획기적", "패러다임", "게임 체인저", "게임체인저", "새로운 지평"];
    for (const i of SAMPLE_FEED) {
      const text = JSON.stringify(i);
      for (const b of banned) expect(text.includes(b), `${i.id}: ${b}`).toBe(false);
    }
  });
});

describe("filters", () => {
  it("filters by category, sorted by importance — no article is hidden by difficulty any more", () => {
    const research = filterItems(SAMPLE_FEED, "research");
    expect(research.every((i) => i.category === "research")).toBe(true);
    expect(research[0].importance_score).toBeGreaterThanOrEqual(research[1].importance_score);
    expect(filterItems(SAMPLE_FEED, "all")).toHaveLength(SAMPLE_FEED.length);
    expect(new Set(SAMPLE_FEED.map((i) => i.difficulty))).toEqual(new Set([1, 2, 3]));
  });

  it("keyword search matches title, benefit tag, body, entity tags and platform name (all words, any case)", () => {
    const names = new Map((samplePlatforms as Platform[]).map((p) => [p.id, p.name]));
    expect(filterItems(SAMPLE_FEED, "all", "vllm").map((i) => i.id)).toContain("sample-vllm-0-34");
    expect(filterItems(SAMPLE_FEED, "all", "1.95배").map((i) => i.id)).toEqual(["sample-vllm-0-34"]);
    expect(filterItems(SAMPLE_FEED, "all", "text-to-speech").length).toBeGreaterThanOrEqual(2);
    expect(filterItems(SAMPLE_FEED, "all", "bluesky", names).every((i) => i.platform_id === "bluesky")).toBe(true);
    expect(filterItems(SAMPLE_FEED, "all", "GEMINI 구글").length).toBeGreaterThanOrEqual(1);
    expect(filterItems(SAMPLE_FEED, "all", "존재하지않는검색어xyz")).toEqual([]);
    expect(matchesQuery(SAMPLE_FEED[0], "   ")).toBe(true);
  });

  it("groups platforms with active ones first", () => {
    const groups = groupPlatforms(samplePlatforms as Platform[], "all");
    expect(groups.map(([c]) => c)).toEqual(CATEGORY_ORDER);
    for (const [, list] of groups) {
      const firstDir = list.findIndex((p) => p.collect_status === "directory_only");
      if (firstDir >= 0) expect(list.slice(firstDir).every((p) => p.collect_status === "directory_only")).toBe(true);
    }
  });

  it("returns at most 3 recent items for a platform", () => {
    const hf = recentForPlatform(SAMPLE_FEED, "huggingface");
    expect(hf.length).toBeLessThanOrEqual(3);
    expect(hf.every((i) => i.platform_id === "huggingface")).toBe(true);
  });
});

describe("data loading", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to sample data when Supabase env vars are empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(getSupabaseEnv()).toBeNull();
    const data = await loadRadarData();
    expect(data.source).toBe("sample");
    expect(data.platforms).toHaveLength(141);
    expect(data.items).toHaveLength(SAMPLE_FEED.length);
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
    expect(data.notice).toBeTruthy();
  });

  it("falls back to sample data when Supabase is unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loadRadarData();
    expect(data.source).toBe("sample");
    expect(data.notice).toContain("연결");
    spy.mockRestore();
  });

  it("normalizes PostgREST rows with embedded summary (object or array)", () => {
    const base = {
      id: "1", platform_id: "huggingface", category: "research", canonical_url: "https://x", thumbnail_url: null,
      importance_score: 12.5, source_count: 2, lifecycle_status: "warm", published_at: null, created_at: "2026-11-19T00:00:00Z",
    };
    const summary = {
      hook_title: "훅", context_ko: "c", what_ko: "w", analogy_ko: null, why_ko: "y", caveats_ko: null,
      difficulty: 3, terms_json: [{ term: "LoRA", easy: "e" }, { bad: true }], extracted_entities: [{ name: "Q", kind: "model", tags: [] }],
    };
    const a = normalizeFeedRow({ ...base, summaries: summary });
    const b = normalizeFeedRow({ ...base, summaries: [summary] });
    expect(a).toEqual(b);
    expect(a?.terms).toEqual([{ term: "LoRA", easy: "e" }]);
    expect(a?.difficulty).toBe(3);
    expect(a?.lifecycle_status).toBe("warm");
    expect(normalizeFeedRow({ ...base, lifecycle_status: "weird", summaries: summary })?.lifecycle_status).toBe("hot");
    expect(normalizeFeedRow({ ...base, summaries: null })).toBeNull();
  });
});

describe("hourly rotation in the UI", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const mk = (id: string, hoursAgo: number, score: number, life: "hot" | "warm" = "hot") => ({
    ...SAMPLE_FEED[0],
    id,
    importance_score: score,
    lifecycle_status: life,
    created_at: new Date(now - hoursAgo * 3_600_000).toISOString(),
  });

  it("hot rank lets a fresh story beat an older high-score one", () => {
    expect(hotRankScore(mk("a", 1, 20), now)).toBeGreaterThan(hotRankScore(mk("b", 30, 40), now));
    expect(hotRankScore(mk("c", 0, 10), now)).toBeCloseTo(10 / Math.pow(2, 1.5));
    const feed = hotFeed([mk("old", 30, 40), mk("fresh", 1, 20), mk("past", 1, 99, "warm")], "all", now);
    expect(feed.map((i) => i.id)).toEqual(["fresh", "old"]);
  });

  it("caps the live feed at 100 and keeps warm items in the past tab", () => {
    const many = Array.from({ length: 130 }, (_, i) => mk(`h${i}`, i, 30));
    expect(hotFeed(many, "all", now)).toHaveLength(HOT_LIMIT);
    const past = pastFeed([mk("w1", 200, 10, "warm"), mk("w2", 300, 30, "warm"), mk("h", 1, 50)], "all");
    expect(past.map((i) => i.id)).toEqual(["w2", "w1"]);
  });

  it("renders live relative-time badges (KST calendar for 오늘/어제)", () => {
    // now = 2026-11-19 12:00Z = 21:00 KST
    const ago = (min: number) => new Date(now - min * 60_000).toISOString();
    expect(freshness(ago(0.2), now)).toEqual({ label: "방금 전", fresh: true });
    expect(freshness(ago(25), now)).toEqual({ label: "25분 전", fresh: true });
    expect(freshness(ago(150), now)).toEqual({ label: "2시간 전", fresh: true });
    expect(freshness(ago(5 * 60), now)).toEqual({ label: "오늘 · 5시간 전", fresh: false });
    expect(freshness(ago(22 * 60), now)).toEqual({ label: "어제", fresh: false }); // 11-18 23:00 KST
    expect(freshness(ago(3 * 24 * 60), now)).toEqual({ label: "3일 전", fresh: false });
    expect(freshness("2026-11-01T10:00:00Z", now)).toEqual({ label: "2026.11.01", fresh: false });
    expect(freshness("not a date", now).label).toBe("");
  });

  it("sample data ranks a non-empty live feed with every category present", () => {
    const feed = hotFeed(SAMPLE_FEED, "all", Date.parse("2026-11-19T09:00:00Z"));
    expect(feed.length).toBeGreaterThanOrEqual(24);
    expect(new Set(feed.map((i) => i.category))).toEqual(new Set(CATEGORY_ORDER));
  });
});

describe("TOP SPOTLIGHT & sample timing", () => {
  const ref = SAMPLE_REFERENCE_TIME;

  it("spotlight skips short social posts and prefers articles with a ready easy-original", () => {
    const base = SAMPLE_FEED.find((i) => i.id === "sample-vllm-0-34")!;
    const social = { ...base, id: "s", category: "social" as const, difficulty: 1 as const, easy_original_ready: true };
    const plain = { ...base, id: "p", category: "dev" as const, difficulty: 2 as const, easy_original_ready: false };
    const ready = { ...base, id: "r", category: "research" as const, difficulty: 3 as const, easy_original_ready: true };
    const lightTrend = { ...base, id: "t", category: "image_design" as const, difficulty: 1 as const, easy_original_ready: false };
    expect(isSpotlightEligible(social)).toBe(false);
    expect(isSpotlightEligible(lightTrend)).toBe(false);
    expect(pickSpotlight([social, plain, ready, lightTrend]).map((i) => i.id)).toEqual(["r", "p"]);
  });

  it("in sample mode the spotlight and the first row come from the articles with walkthroughs", () => {
    const ranked = hotFeed(SAMPLE_FEED, "all", ref);
    const tops = pickSpotlight(ranked);
    expect(tops).toHaveLength(2);
    expect(tops.every((i) => i.easy_original_ready && i.category !== "social")).toBe(true);
    const rest = ranked.filter((i) => !tops.includes(i));
    expect(rest.slice(0, 3).every((i) => i.easy_original_ready)).toBe(true);
    // 기존 8편 + 국내 기술 아티클 3편 (토스 2 · GPTers 1)
    expect(SAMPLE_FEED.filter((i) => i.easy_original_ready)).toHaveLength(11);
  });

  it("sample collection times spread from ~20 minutes to ~5 days (hot) and 8+ days (warm)", () => {
    const minutesAgo = (i: (typeof SAMPLE_FEED)[number]) => (ref - Date.parse(i.created_at)) / 60_000;
    const hot = SAMPLE_FEED.filter((i) => i.lifecycle_status === "hot").map(minutesAgo);
    const warm = SAMPLE_FEED.filter((i) => i.lifecycle_status === "warm").map(minutesAgo);
    expect(Math.min(...hot)).toBe(20);
    expect(Math.max(...hot)).toBeLessThanOrEqual(5 * 24 * 60);
    expect(Math.max(...hot)).toBeGreaterThan(4 * 24 * 60);
    expect(warm.every((m) => m > 7 * 24 * 60 && m <= 30 * 24 * 60)).toBe(true);
    // 상대 시간 라벨이 다양하게 나와야 라이브 피드처럼 보인다
    const labels = new Set(SAMPLE_FEED.map((i) => freshness(i.created_at, ref).label.replace(/\d+/g, "N")));
    for (const l of ["N분 전", "N시간 전", "오늘 · N시간 전", "어제", "N일 전"]) expect(labels.has(l), l).toBe(true);
    // 사이트를 열 때마다 '지금' 기준으로 다시 계산된다
    const later = buildSampleFeed(ref + 3_600_000);
    expect(Date.parse(later[0].created_at) - Date.parse(SAMPLE_FEED[0].created_at)).toBe(3_600_000);
  });

  it("dense articles carry a realistic source-difficulty badge", () => {
    const byId = (id: string) => SAMPLE_FEED.find((i) => i.id === id)!;
    expect(byId("sample-gemini-4-neon").difficulty).toBeGreaterThanOrEqual(2);
    expect(byId("sample-google-ai-answers-traffic").difficulty).toBeGreaterThanOrEqual(2);
  });
});

describe("card face helpers, directory filters, sharing", () => {
  it("drops entities that repeat the card's platform and keeps the rest unique", async () => {
    const { visibleEntities } = await import("@/components/ItemCard");
    const base = SAMPLE_FEED.find((i) => i.id === "sample-gemini-4-neon")!;
    const platform = (samplePlatforms as Platform[]).find((p) => p.id === base.platform_id);
    const names = visibleEntities(base, platform);
    expect(names).toContain("Gemini 4 Neon");
    expect(names).not.toContain("Google DeepMind");
  });

  it("every sample card lists its source platforms (multi-source cards include Hacker News)", () => {
    for (const i of SAMPLE_FEED) {
      expect(i.source_platforms[0], i.id).toBe(i.platform_id);
      expect(i.source_platforms.length, i.id).toBe(i.source_count);
    }
    expect(SAMPLE_FEED.find((i) => i.id === "sample-anthropic-ipo")!.source_platforms).toEqual(["anthropic", "hacker-news"]);
  });

  it("directory quick filters narrow the 141 platforms by trait", async () => {
    const { matchesPlatformFilter } = await import("@/lib/platform-traits");
    const platforms = samplePlatforms as Platform[];
    const count = (f: "all" | "live" | "free" | "open_local") => platforms.filter((p) => matchesPlatformFilter(p, f)).length;
    expect(count("all")).toBe(141);
    expect(count("live")).toBe(52);
    expect(count("free")).toBe(27);
    expect(count("open_local")).toBe(21);
    expect(platforms.some((p) => p.id === "midjourney" && matchesPlatformFilter(p, "free"))).toBe(false);
  });

  it("share URLs carry exactly one selection param", async () => {
    const { shareUrlFor } = await import("@/components/ContextPanel");
    const loc = { origin: "https://radar.example", pathname: "/" };
    expect(shareUrlFor({ type: "item", id: "sample-vllm-0-34" }, loc)).toBe("https://radar.example/?item=sample-vllm-0-34");
    expect(shareUrlFor({ type: "platform", id: "r/odd id" }, loc)).toBe("https://radar.example/?platform=r%2Fodd%20id");
  });
});
