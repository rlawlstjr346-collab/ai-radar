/**
 * 구멍 제로 계약 — 배포본에서 어떤 기사·탭·버튼·필터를 눌러도 "준비 중 / 샘플이라 안 됨 / 결과 0건 / 가짜 링크"가
 * 나오지 않도록 데이터·문구·연결을 전수 검사한다. 이 테스트가 깨지면 배포하지 않는다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import samplePlatforms from "@/data/platforms.sample.json";
import { SAMPLE_EASY_ORIGINAL } from "@/data/sample-easy-original";
import { SAMPLE_FEED, SAMPLE_REFERENCE_TIME } from "@/data/sample-feed";
import { CATEGORY_ORDER } from "@/lib/categories";
import { loadRadarData } from "@/lib/data";
import { getEasyOriginal } from "@/lib/easy-original";
import { synthesizeEasyOriginal } from "@/lib/easy-synth";
import { hotFeed, pastFeed } from "@/lib/filter";
import { loadLiveSnapshot } from "@/lib/live-snapshot";
import { matchesPlatformFilter, type PlatformFilter } from "@/lib/platform-traits";
import { buildProjectGuide } from "@/lib/project-guide";
import { matchesRegion, REGION_ORDER } from "@/lib/regions";
import type { Platform } from "@/lib/types";

const platforms = samplePlatforms as Platform[];
const names = new Map(platforms.map((p) => [p.id, p.name]));
const now = SAMPLE_REFERENCE_TIME;

/** 사용자에게 '미완성'으로 보이는 문구 — 화면 코드·데이터 어디에도 있으면 안 된다 */
const BANNED_UI_PHRASES = ["아직 원본 해설을 준비하지 않았어요", "데이터베이스와 AI 키를 연결하면", "샘플 데이터 모드", "준비 중", "Coming Soon", "TODO"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|json)$/.test(name) ? [p] : [];
  });
}

describe("1. 모든 기사가 4단 요약과 [원본 쉽게 읽기]를 가진다", () => {
  it.each(SAMPLE_FEED.map((i) => [i.id, i] as const))("%s", (_id, item) => {
    for (const field of [item.hook_title, item.context_ko, item.what_ko, item.why_ko]) {
      expect(field?.trim().length ?? 0).toBeGreaterThan(0);
    }
    const easy = SAMPLE_EASY_ORIGINAL[item.id] ?? synthesizeEasyOriginal(item);
    expect(easy.sections.length).toBeGreaterThanOrEqual(3);
    for (const s of easy.sections) {
      expect(s.heading.trim().length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(0);
    }
    expect(easy.watch_points.length).toBeGreaterThanOrEqual(2);
  });

  it("X·Bluesky 단문은 3단 구조(원문 해독 → 화제 맥락 → 실전 활용)로 열린다", () => {
    const shorts = SAMPLE_FEED.filter((i) => i.platform_id === "x" || i.platform_id === "bluesky");
    expect(shorts.length).toBeGreaterThan(0);
    for (const i of shorts) {
      if (SAMPLE_EASY_ORIGINAL[i.id]) continue;
      expect(synthesizeEasyOriginal(i).sections.map((s) => s.heading)).toEqual([
        "1. 핵심 포스트 원문 해독",
        "2. 왜 개발자들 사이에서 화제인가",
        "3. 실전 활용 포인트",
      ]);
    }
  });

  describe("API 도 모든 기사에 대해 'ready' 를 돌려준다 (샘플 모드)", () => {
    afterEach(() => vi.unstubAllEnvs());
    it("118건 전수", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
      for (const item of SAMPLE_FEED) {
        const r = await getEasyOriginal(item.id);
        expect(r.body.status, item.id).toBe("ready");
      }
    });
  });

  it("실전 도입 가이드도 모든 기사에서 세 부분이 다 채워진다", () => {
    for (const item of SAMPLE_FEED) {
      const g = buildProjectGuide(item, names.get(item.platform_id));
      expect(g.useWhen.length, item.id).toBeGreaterThan(20);
      expect(g.checkpoints.map((c) => c.label)).toEqual(["난이도", "비용", "주의"]);
      expect(g.checkpoints.every((c) => c.text.length > 10), item.id).toBe(true);
      expect(g.prompt).toContain("기존 기능을 깨뜨리지 않고");
      expect(g.prompt).toContain(item.canonical_url);
    }
  });
});

describe("2. 모든 링크는 실제 https 주소이고 ID·URL 이 겹치지 않는다", () => {
  const bad = (u: string) => !/^https:\/\/[^/\s]+\.[^/\s]+/.test(u) || /example\.(com|org)|localhost|127\.0\.0\.1/.test(u);

  it("기사 118건", () => {
    expect(SAMPLE_FEED.filter((i) => bad(i.canonical_url)).map((i) => i.id)).toEqual([]);
    expect(new Set(SAMPLE_FEED.map((i) => i.id)).size).toBe(SAMPLE_FEED.length);
    expect(new Set(SAMPLE_FEED.map((i) => i.canonical_url)).size).toBe(SAMPLE_FEED.length);
  });

  it("플랫폼 141곳", () => {
    expect(platforms.filter((p) => bad(p.url)).map((p) => p.id)).toEqual([]);
    expect(new Set(platforms.map((p) => p.id)).size).toBe(platforms.length);
  });

  it("2026-11-21 전수 점검에서 410·DNS 실패였던 주소는 다시 들어오지 않는다", () => {
    const urls = platforms.map((p) => p.url);
    expect(urls).not.toContain("https://getliner.com");
    expect(urls).not.toContain("https://rinna.co.jp");
  });

  it("모든 기사는 도감에 있는 플랫폼에서 왔다", () => {
    const ids = new Set(platforms.map((p) => p.id));
    expect(SAMPLE_FEED.filter((i) => !ids.has(i.platform_id) || i.source_platforms.some((s) => !ids.has(s))).map((i) => i.id)).toEqual([]);
  });
});

describe("3. 미완성 문구 0건", () => {
  const root = join(__dirname, "..", "src");
  it.each(sourceFiles(root).map((f) => [f.slice(root.length + 1), f] as const))("%s", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    for (const phrase of BANNED_UI_PHRASES) expect(text.includes(phrase), phrase).toBe(false);
  });

  it("합성된 완독 가이드·도입 가이드에도 없다", () => {
    for (const item of SAMPLE_FEED) {
      const text = JSON.stringify([synthesizeEasyOriginal(item), buildProjectGuide(item)]);
      for (const phrase of BANNED_UI_PHRASES) expect(text.includes(phrase), `${item.id}: ${phrase}`).toBe(false);
    }
  });
});

describe("4. 어떤 필터·태그를 눌러도 결과가 1건 이상", () => {
  it("실시간 레이더 · 지난 주요 소식 × 7개 분야 + 전체", () => {
    for (const c of ["all", ...CATEGORY_ORDER] as const) {
      expect(hotFeed(SAMPLE_FEED, c, now).length, `live ${c}`).toBeGreaterThan(0);
      expect(pastFeed(SAMPLE_FEED, c).length, `past ${c}`).toBeGreaterThan(0);
    }
  });

  it("도감: 7개 분야, 4개 성격 필터, 6개 권역 필터", () => {
    for (const c of CATEGORY_ORDER) expect(platforms.filter((p) => p.category === c).length, c).toBeGreaterThan(0);
    for (const f of ["all", "live", "free", "open_local"] as PlatformFilter[]) {
      expect(platforms.filter((p) => matchesPlatformFilter(p, f)).length, f).toBeGreaterThan(0);
    }
    for (const r of REGION_ORDER) expect(platforms.filter((p) => matchesRegion(p, r)).length, r).toBeGreaterThan(0);
  });

  it("모든 기사의 기술 태그(엔티티)는 그 기사가 보이는 탭의 검색에서 최소 1건을 찾는다", () => {
    const misses: string[] = [];
    for (const item of SAMPLE_FEED) {
      for (const e of item.entities) {
        const list =
          item.lifecycle_status === "warm" ? pastFeed(SAMPLE_FEED, "all", e.name, names) : hotFeed(SAMPLE_FEED, "all", now, e.name, names);
        if (!list.some((i) => i.id === item.id)) misses.push(`${item.id}: ${e.name}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("도감 프로필의 '여기서 최근 물어온 소식'은 피드에 있는 기사로만 연결된다", () => {
    const ids = new Set(SAMPLE_FEED.map((i) => i.id));
    for (const p of platforms) {
      for (const i of SAMPLE_FEED.filter((x) => x.platform_id === p.id)) expect(ids.has(i.id)).toBe(true);
    }
  });
});

describe("5. live-feed.json 스냅샷 + 기본 피드 병합 데이터 전수 계약", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("병합 피드의 모든 기사(live-feed.json 포함)가 4단 요약·유효 https 링크·금지어 0건·완독 해설 ready 를 만족한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const snap = loadLiveSnapshot();
    const data = await loadRadarData();
    const bad = (u: string) => !/^https:\/\/[^/\s]+\.[^/\s]+/.test(u) || /example\.(com|org)|localhost|127\.0\.0\.1/.test(u);
    const platformIds = new Set(platforms.map((p) => p.id));

    expect(new Set(data.items.map((i) => i.id)).size).toBe(data.items.length);
    expect(new Set(data.items.map((i) => i.canonical_url)).size).toBe(data.items.length);

    for (const item of snap.items) {
      expect(bad(item.canonical_url), item.id).toBe(false);
      expect(platformIds.has(item.platform_id), `${item.id}: ${item.platform_id}`).toBe(true);
      for (const field of [item.hook_title, item.context_ko, item.what_ko, item.why_ko]) {
        expect(field?.trim().length ?? 0, item.id).toBeGreaterThan(0);
      }
      const res = await getEasyOriginal(item.id);
      expect(res.httpStatus, item.id).toBe(200);
      expect(res.body.status, item.id).toBe("ready");
      if (res.body.status === "ready") {
        expect(res.body.easy_original.sections.length, item.id).toBeGreaterThanOrEqual(3);
      }
      const blob = JSON.stringify([item, res.body, buildProjectGuide(item, names.get(item.platform_id))]);
      for (const phrase of BANNED_UI_PHRASES) expect(blob.includes(phrase), `${item.id}: ${phrase}`).toBe(false);
    }

    const mergedNow = Date.parse(data.generatedAt);
    for (const c of ["all", ...CATEGORY_ORDER] as const) {
      expect(hotFeed(data.items, c, mergedNow).length, `merged live ${c}`).toBeGreaterThan(0);
      expect(pastFeed(data.items, c).length, `merged past ${c}`).toBeGreaterThan(0);
    }
  });
});
