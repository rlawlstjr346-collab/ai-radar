import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getPlanningFeed } from "@/app/api/planning-feed/route";
import { SAMPLE_FEED } from "@/data/sample-feed";
import { getHighlightSummary, getPlanningMeta, getUtilityInsight } from "@/lib/reading-insights";
import { contrastRatio, FONT_SIZE_STORAGE_KEY, parseFontSize, THEME_BOOT_SCRIPT, THEME_TOKENS } from "@/lib/theme";

describe("형광펜 핵심 요약 · 실전 효용 팁 · 기획팀 메타", () => {
  it("기존 저장/샘플 기사 전수에서 형광펜 핵심 요약과 3단 실전 효용 팁이 비어 있지 않다", () => {
    for (const item of SAMPLE_FEED) {
      const hl = getHighlightSummary(item);
      expect(hl.length, item.id).toBeGreaterThan(10);
      expect(hl, item.id).toContain("==");

      const util = getUtilityInsight(item);
      expect(util.when_needed.length, item.id).toBeGreaterThan(12);
      expect(util.work_utility.length, item.id).toBeGreaterThan(12);
      expect(util.practical_tip.length, item.id).toBeGreaterThan(12);

      const meta = getPlanningMeta(item);
      expect(meta.signal_type.length, item.id).toBeGreaterThan(3);
      expect(meta.product_domain.length, item.id).toBeGreaterThan(3);
      expect(meta.benchmark_point.length, item.id).toBeGreaterThan(3);
      expect(meta.actionable_idea.length, item.id).toBeGreaterThan(10);
    }
  });

  describe("/api/planning-feed 엔드포인트", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("하위 AI 기획팀 에이전트가 읽을 수 있는 구조화 JSON 시그널을 반환한다", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
      const res = await getPlanningFeed(new Request("https://ai-radar.vercel.app/api/planning-feed?limit=15"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        version: number;
        item_count: number;
        signals: Array<{ id: string; planning_meta: { signal_type: string; product_domain: string; benchmark_point: string; actionable_idea: string } }>;
      };
      expect(body.version).toBe(1);
      expect(body.item_count).toBeGreaterThan(0);
      expect(body.item_count).toBeLessThanOrEqual(15);
      for (const s of body.signals) {
        expect(s.planning_meta.signal_type).toBeTruthy();
        expect(s.planning_meta.product_domain).toBeTruthy();
        expect(s.planning_meta.benchmark_point).toBeTruthy();
        expect(s.planning_meta.actionable_idea).toBeTruthy();
      }
    });
  });
});

describe("가+ 글자 크기 토글 · 명도 대비 WCAG AA · 순수 흑백 S-커브 로고", () => {
  it("글자 크기 기본값은 standard, large 저장 시에만 크게 전환되고 부트 스크립트가 읽는다", () => {
    expect(parseFontSize(null)).toBe("standard");
    expect(parseFontSize("large")).toBe("large");
    expect(parseFontSize("other")).toBe("standard");
    expect(THEME_BOOT_SCRIPT).toContain(FONT_SIZE_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain('dataset.fontSize="large"');
  });

  it("메타/보조 회색(--text-tertiary)도 라이트·다크 양쪽에서 WCAG AA 4.5:1 이상을 확보한다", () => {
    for (const theme of ["paper", "dark"] as const) {
      const t = THEME_TOKENS[theme];
      expect(contrastRatio(t["--text-tertiary"], t["--bg-base"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t["--text-tertiary"], t["--bg-surface"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("파비콘(icon.svg)과 BrandLogo 는 유채색 없이 순수 흑백 벡터로 구성된다", () => {
    const iconSvg = readFileSync(join(__dirname, "../src/app/icon.svg"), "utf8");
    const brandTsx = readFileSync(join(__dirname, "../src/components/BrandLogo.tsx"), "utf8");
    expect(iconSvg).not.toContain("#016A71");
    expect(iconSvg).toContain("#0F0F0F");
    expect(iconSvg).toContain("#F7F7F7");
    expect(brandTsx).not.toContain("var(--accent)");
    expect(brandTsx).toContain("currentColor");
  });
});
