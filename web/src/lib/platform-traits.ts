import type { Platform } from "./types";

/**
 * 플랫폼 도감 빠른 필터용 성격 분류 (수동 큐레이션).
 * 각 항목은 시드의 access_note 에 근거한다 — 키워드 자동 추정은 블로그의 "무료로 읽을 수 있어요"까지
 * '무료 체험'으로 잘못 잡기 때문에 직접 고른다. 새 플랫폼을 시드에 넣으면 여기도 함께 갱신할 것.
 */

/** 직접 써 보는 도구 중 무료 플랜·무료 크레딧·무료 앱이 있는 곳 */
export const FREE_TRIAL_IDS = new Set([
  "huggingface", // 구경 무료, Spaces 데모
  "ollama", // 완전 무료 앱
  "comfyui", // 오픈소스 무료
  "civitai", // 모델 구경·다운로드 무료
  "lm-studio", // 개인 사용 무료
  "lmarena", // 무료로 바로 대결 참여
  "notebooklm", // 구글 계정으로 무료
  "openrouter", // 일부 무료 모델
  "perplexity", // 기본 검색 무료
  "krea", // 무료 플랜(하루 제한)
  "elevenlabs", // 무료 플랜(매달)
  "kling", // 매일 무료 크레딧
  "luma", // 체험용 크레딧
  "runway", // 체험용 크레딧
  "suno", // 매일 무료 크레딧
]);

/** 코드·모델을 공개하거나 내 컴퓨터에서 직접 돌리는 곳 */
export const OPEN_LOCAL_IDS = new Set(["huggingface", "github", "ollama", "comfyui", "lm-studio", "civitai"]);

export type PlatformFilter = "all" | "live" | "free" | "open_local";

export const PLATFORM_FILTER_LABEL: Record<PlatformFilter, string> = {
  all: "전체",
  live: "실시간 자동수집",
  free: "무료 체험 가능",
  open_local: "오픈소스·로컬",
};

export function matchesPlatformFilter(p: Platform, f: PlatformFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "live":
      return p.collect_status === "active";
    case "free":
      return FREE_TRIAL_IDS.has(p.id);
    case "open_local":
      return OPEN_LOCAL_IDS.has(p.id);
  }
}
