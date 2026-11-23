import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getPlanningFeed } from "@/app/api/planning-feed/route";
import { SAMPLE_FEED } from "@/data/sample-feed";
import { loadLiveSnapshot } from "@/lib/live-snapshot";
import { getHighlightSummary, getPlanningMeta, getUtilityInsight } from "@/lib/reading-insights";
import {
  contrastRatio,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  parseFontPercent,
  parseFontSize,
  THEME_BOOT_SCRIPT,
  THEME_TOKENS,
} from "@/lib/theme";

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

describe("Apple ML Research 좌측 컬러 도트 · 무한 스크롤 · 고밀도 리퀴드 글라스 · 잘림 없는 흑백 로고 & 공식 X 로고", () => {
  it("테마 유틸과 부트 스크립트가 기본 라이트/다크 전환을 안전하게 처리한다", () => {
    expect(FONT_SCALE_MIN).toBe(85);
    expect(FONT_SCALE_MAX).toBe(200);
    expect(parseFontSize(null)).toBe("standard");
    expect(parseFontSize("large")).toBe("large");
    expect(parseFontPercent(null)).toBe(FONT_SCALE_DEFAULT);
    expect(THEME_BOOT_SCRIPT).toContain("ai-radar-theme-v2");
  });

  it("메타/보조 회색(--text-tertiary)도 라이트·다크 양쪽에서 WCAG AA 4.5:1 이상을 확보한다", () => {
    for (const theme of ["paper", "dark"] as const) {
      const t = THEME_TOKENS[theme];
      expect(contrastRatio(t["--text-tertiary"], t["--bg-base"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t["--text-tertiary"], t["--bg-surface"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("파비콘(icon.svg), BrandLogo, 공식 XLogo 는 잘림 없는 여백과 순수 흑백 벡터로 구성된다", () => {
    const iconSvg = readFileSync(join(__dirname, "../src/app/icon.svg"), "utf8");
    const brandTsx = readFileSync(join(__dirname, "../src/components/BrandLogo.tsx"), "utf8");
    const xLogoTsx = readFileSync(join(__dirname, "../src/components/XLogo.tsx"), "utf8");
    expect(iconSvg).toContain('viewBox="0 0 48 48"');
    expect(iconSvg).toContain("#0F0F0F");
    expect(iconSvg).toContain("#F7F7F7");
    expect(brandTsx).toContain('viewBox="0 0 48 44"');
    expect(brandTsx).not.toContain("var(--accent)");
    expect(xLogoTsx).toContain('viewBox="0 0 24 24"');
    expect(xLogoTsx).toContain("M18.244 2.25h3.308l-7.227 8.26");
  });

  it("globals.css 는 고정 16px 기본 스케일 + Apple Newsroom 20px 카드 + 고밀도 Liquid Glass 모달 + Health 인셋 카드 + X 워터마크를 정의한다", () => {
    const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
    expect(css).toContain("font-size: 16px;");
    expect(css).toContain(".newsroom-card");
    expect(css).toContain(".liquid-glass-modal");
    expect(css).toContain("rgba(250, 250, 252, 0.94)");
    expect(css).toContain("blur(48px) saturate(190%)");
    expect(css).toContain(".inset-health-card");
    expect(css).toContain(".x-watermark");
    expect(css).toContain("opacity: 0.1;");
    expect(css).toContain("opacity: 0.16;");
    expect(css).not.toContain(".source-card-global");
    expect(css).not.toContain(".summary-card-amber");
  });

  it("RadarApp·Sidebar 는 검색창·글씨크기 슬라이더·수동 더보기 버튼을 제거하고 IntersectionObserver 무한 스크롤을 사용한다", () => {
    const radarTsx = readFileSync(join(__dirname, "../src/components/RadarApp.tsx"), "utf8");
    const sidebarTsx = readFileSync(join(__dirname, "../src/components/Sidebar.tsx"), "utf8");
    expect(radarTsx).toContain("IntersectionObserver");
    expect(radarTsx).toContain('rootMargin: "400px"');
    expect(radarTsx).not.toContain("FontSizeToggle");
    expect(radarTsx).not.toContain("더보기");
    expect(sidebarTsx).not.toContain("FontSizeToggle");
    expect(sidebarTsx).toContain("border-b-[1.5px] border-fg");
  });

  it("live-feed.json 전 기사가 도입부 잡담·복붙 템플릿·미번역 외국어 제목 0건 및 원본 쉽게 읽기 > 1분 요약 분량을 보장한다", () => {
    const snap = loadLiveSnapshot();
    expect(snap.items.length).toBeGreaterThan(20);
    const stockBoilerplate = [
      "이 글에서 다루는 핵심 변화를 쉽게 풀어서 정리했습니다",
      "현업·개인 사용자 입장에서 바로 체감되는 변화를 짚어봅니다",
      "공식 발표에서 새로 공개된 변경점과 활용 맥락을 정리했습니다",
    ];
    for (const item of snap.items) {
      expect(item.what_ko ?? "", item.id).not.toContain("로이킴");
      expect(item.highlight_summary ?? "", item.id).not.toContain("로이킴");
      for (const bp of stockBoilerplate) {
        expect(item.what_ko ?? "", `${item.id} boilerplate what_ko`).not.toContain(bp);
      }
      // 일본어 히라가나/가타카나 잔존 0건 + 순수 영문 미번역 제목 0건 (한글 최소 1자 이상 포함)
      expect(item.hook_title, `${item.id} Japanese title`).not.toMatch(/[ぁ-んァ-ヶ]/);
      expect(item.hook_title, `${item.id} untranslated English title`).toMatch(/[가-힣]/);

      const easy = snap.easyOriginals[item.id];
      expect(easy, item.id).toBeDefined();
      const summaryLen = [item.highlight_summary, item.context_ko, item.what_ko, item.why_ko, item.caveats_ko]
        .filter(Boolean)
        .join("").length;
      const easyLen = easy.sections.reduce((acc, s) => acc + s.heading.length + s.body.length, 0);
      expect(easyLen, `${item.id}: easy(${easyLen}) <= summary(${summaryLen})`).toBeGreaterThan(summaryLen);
    }
  });
});
