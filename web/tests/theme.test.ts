import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildSampleFeed, SAMPLE_REFERENCE_TIME } from "@/data/sample-feed";
import { EDITORIAL_TOP, editorialLayout, editorialOrder, hotFeed, pickSpotlight } from "@/lib/filter";
import { contrastRatio, parseTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, THEME_TOKENS } from "@/lib/theme";

const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

describe("DESIGN.md 토큰 ↔ globals.css", () => {
  it.each([
    ["paper", ":root"],
    ["dark", ':root[data-theme="dark"]'],
  ] as const)("%s 테마 값이 CSS 변수와 일치한다", (theme, selector) => {
    const body = block(selector).toLowerCase();
    for (const [name, hex] of Object.entries(THEME_TOKENS[theme])) {
      expect(body).toContain(`${name}: ${hex.toLowerCase()};`);
    }
  });

  it("기본(:root)이 종이 테마라 첫 페인트부터 종이 — 순백 #FFFFFF 는 쓰지 않는다", () => {
    expect(block(":root")).toContain("color-scheme: light");
    expect(block(":root").toLowerCase()).not.toMatch(/#fff(fff)?\b/);
    expect(block(':root[data-theme="dark"]')).toContain("color-scheme: dark");
  });

  it("마우스 추적 글로우·필름 그레인 장식이 사라졌다", () => {
    expect(css).not.toContain("mouse-glow");
    expect(css).not.toContain("feTurbulence");
  });
});

describe("대비율 (WCAG)", () => {
  it.each(["dark", "paper"] as const)("%s: 본문·보조·accent 가 기준을 넘는다", (theme) => {
    const t = THEME_TOKENS[theme];
    expect(contrastRatio(t["--text-primary"], t["--bg-base"])).toBeGreaterThanOrEqual(14);
    expect(contrastRatio(t["--text-primary"], t["--bg-surface"])).toBeGreaterThanOrEqual(13);
    expect(contrastRatio(t["--text-secondary"], t["--bg-base"])).toBeGreaterThanOrEqual(6.5);
    expect(contrastRatio(t["--text-secondary"], t["--bg-elevated"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["--accent"], t["--bg-surface"])).toBeGreaterThanOrEqual(4.5);
    // solid CTA: bg-fg 위의 canvas 글자
    expect(contrastRatio(t["--bg-base"], t["--text-primary"])).toBeGreaterThanOrEqual(14);
  });

  it("다크 본문 대비는 14:1, 보조는 7.4:1 이상 (브리프 기준)", () => {
    expect(contrastRatio("#F0F0F0", "#0F0F10")).toBeGreaterThanOrEqual(14);
    expect(contrastRatio("#A1A1A6", "#0F0F10")).toBeGreaterThanOrEqual(7.4);
  });
});

describe("테마 저장", () => {
  it("첫 방문·알 수 없는 값은 종이로, 다크는 고른 사람만", () => {
    expect(parseTheme(null)).toBe("paper");
    expect(parseTheme(undefined)).toBe("paper");
    expect(parseTheme("weird")).toBe("paper");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("저장 키는 v2 — 예전 키에 남은 다크 선택은 무시하고 종이로 새로 시작", () => {
    expect(THEME_STORAGE_KEY).toBe("ai-radar-theme-v2");
    expect(THEME_BOOT_SCRIPT).toContain('==="dark"');
    expect(THEME_BOOT_SCRIPT).toContain('dataset.theme="dark"');
  });

  it("부트 스크립트가 같은 저장 키를 읽고, 저장소 오류를 삼킨다", () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT.startsWith("try{")).toBe(true);
  });
});

describe("에디토리얼 1면 (리드 1 + 피처 2 + 스트림)", () => {
  const now = SAMPLE_REFERENCE_TIME;
  const ranked = hotFeed(buildSampleFeed(now), "all", now);

  it("리드 1개와 피처 2개를 pickSpotlight 순서로 고르고, 나머지는 스트림", () => {
    const l = editorialLayout(ranked, true);
    const tops = pickSpotlight(ranked, EDITORIAL_TOP);
    expect(l.lead?.id).toBe(tops[0].id);
    expect(l.features.map((i) => i.id)).toEqual(tops.slice(1).map((i) => i.id));
    expect(l.features).toHaveLength(2);
    expect(l.stream).toHaveLength(ranked.length - 3);
    expect(new Set(editorialOrder(l)).size).toBe(ranked.length);
  });

  it("리드는 기본 선택(TOP 01)과 같은 기사다", () => {
    expect(editorialLayout(ranked, true).lead?.id).toBe(pickSpotlight(ranked)[0].id);
  });

  it("필터·검색 모드에서는 리드·피처 없이 원래 순서 그대로 스트림", () => {
    const l = editorialLayout(ranked, false);
    expect(l.lead).toBeNull();
    expect(l.features).toEqual([]);
    expect(editorialOrder(l)).toEqual(ranked.map((i) => i.id));
  });

  it("빈 목록도 안전하다", () => {
    expect(editorialLayout([], true)).toEqual({ lead: null, features: [], stream: [] });
  });
});
