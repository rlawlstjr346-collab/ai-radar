import type { Platform, Region } from "./types";

/** 도감 권역 메타 (migration 006 의 platforms.region) */
export const REGION_ORDER: Region[] = ["kr", "global", "jp", "cn", "eu", "social"];

export const REGION_META: Record<Region, { flag: string; badge: string; filter: string }> = {
  kr: { flag: "🇰🇷", badge: "국내", filter: "국내" },
  global: { flag: "🇺🇸", badge: "글로벌", filter: "북미·글로벌" },
  jp: { flag: "🇯🇵", badge: "일본", filter: "일본" },
  cn: { flag: "🇨🇳", badge: "중국", filter: "중국" },
  eu: { flag: "🇪🇺", badge: "유럽", filter: "유럽·기타" },
  social: { flag: "𝕏", badge: "속보", filter: "𝕏·소셜" },
};

export type RegionFilter = "all" | Region;

export const regionOf = (p?: Pick<Platform, "region">): Region => p?.region ?? "global";

export function matchesRegion(p: Pick<Platform, "region">, f: RegionFilter): boolean {
  return f === "all" || regionOf(p) === f;
}

/** 국내 기술블로그·커뮤니티별 피드 카드 표식 (기본은 권역 기본값) */
const EDITION_BY_PLATFORM: Record<string, string> = {
  "toss-tech": "실전 해독",
  "kakao-tech": "실전 해독",
  "musinsa-tech": "실전 해독",
  "woowahan-tech": "실전 해독",
  "daangn-tech": "엔지니어링",
  "line-engineering": "엔지니어링",
  "naver-d2": "엔지니어링",
  geeknews: "커뮤니티",
  "pytorch-kr": "커뮤니티",
  gpters: "커뮤니티",
  "ai-korea-community": "커뮤니티",
  aitimes: "국내 뉴스",
  "mit-tr-korea": "국내 뉴스",
};
const EDITION_BY_REGION: Partial<Record<Region, string>> = {
  kr: "국내 해독",
  jp: "일어 해독",
  cn: "중어 해독",
};

/**
 * 피드 카드 출처 줄의 조용한 표식: 예) 🇰🇷 … · 실전 해독 / 🇯🇵 … · 일어 해독 / X · 실시간 속보.
 * 북미·글로벌·유럽(영문 원문)은 표식을 붙이지 않는다 — 기존 카드 모양을 그대로 두기 위해서.
 */
export function editionMark(platform?: Platform): { flag: string | null; label: string } | null {
  if (!platform) return null;
  if (platform.id === "x") return { flag: null, label: "𝕏 실시간" };
  const region = regionOf(platform);
  const label = EDITION_BY_PLATFORM[platform.id] ?? EDITION_BY_REGION[region];
  if (!label) return null;
  return { flag: REGION_META[region].flag, label };
}
