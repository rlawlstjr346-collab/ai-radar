import type { Platform } from "./types";

/**
 * 출처군별 카드 뒷배경 틴트 & 선명한 브랜드 배지 분류.
 * 제목을 읽기 전에 카드 색감과 상단 알약 배지만 봐도 출처 성격을 즉시 구분할 수 있다.
 */
export type SourceGroup = "x" | "github" | "global_media" | "kr_media" | "community";

export interface SourceVisual {
  group: SourceGroup;
  label: string;
  cardClass: string;
  badgeClass: string;
}

const GITHUB_PLATFORMS = new Set(["github", "ollama", "comfyui", "modelscope", "langchain"]);
const X_PLATFORMS = new Set(["x"]);
const KR_MEDIA_PLATFORMS = new Set([
  "aitimes",
  "mit-tr-korea",
  "toss-tech",
  "kakao-tech",
  "woowahan-tech",
  "daangn-tech",
  "musinsa-tech",
  "naver-d2",
  "line-engineering",
]);
const COMMUNITY_PLATFORMS = new Set([
  "geeknews",
  "hacker-news",
  "qiita",
  "zenn",
  "gpters",
  "pytorch-kr",
  "ai-korea-community",
  "bluesky",
  "reddit-localllama",
  "reddit-machinelearning",
  "reddit-singularity",
  "reddit-stablediffusion",
  "hatena-bookmark",
  "simon-willison",
  "latent-space",
  "import-ai",
  "ahead-of-ai",
]);

export function classifySourceGroup(platformId: string, platform?: Pick<Platform, "id" | "region">): SourceGroup {
  if (X_PLATFORMS.has(platformId)) return "x";
  if (GITHUB_PLATFORMS.has(platformId)) return "github";
  if (KR_MEDIA_PLATFORMS.has(platformId)) return "kr_media";
  if (COMMUNITY_PLATFORMS.has(platformId)) return "community";
  if (platform?.region === "kr") return "kr_media";
  if (platform?.region === "social") return "community";
  return "global_media";
}

const VISUALS: Record<SourceGroup, SourceVisual> = {
  x: {
    group: "x",
    label: "𝕏 실시간",
    cardClass: "source-card-x",
    badgeClass: "source-badge-x",
  },
  github: {
    group: "github",
    label: "GitHub",
    cardClass: "source-card-github",
    badgeClass: "source-badge-github",
  },
  global_media: {
    group: "global_media",
    label: "글로벌 공식·미디어",
    cardClass: "source-card-global",
    badgeClass: "source-badge-global",
  },
  kr_media: {
    group: "kr_media",
    label: "국내 AI·테크",
    cardClass: "source-card-kr",
    badgeClass: "source-badge-kr",
  },
  community: {
    group: "community",
    label: "개발자 커뮤니티",
    cardClass: "source-card-community",
    badgeClass: "source-badge-community",
  },
};

export function sourceVisualFor(platformId: string, platform?: Pick<Platform, "id" | "region">): SourceVisual {
  return VISUALS[classifySourceGroup(platformId, platform)];
}
