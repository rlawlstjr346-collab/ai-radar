import { computeGravityMetrics } from "./gravity";
import { itemTimestampMs } from "./story-clusterer";
import type { FeedItem } from "./types";

export const LAST_VISIT_STORAGE_KEY = "ai_radar_last_visit_ts";
export const READ_IDS_STORAGE_KEY = "ai_radar_read_ids";
export const MAX_READ_IDS = 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 페이지 최초 진입 시 기존 `ai_radar_last_visit_ts` 를 읽어 세션 상태로 고정하고,
 * 저장소에는 현재 시각(`nowMs`)을 갱신한다.
 * 첫 방문(저장값 없음)이면 `null`을 반환하고 현재 시각만 기록한다.
 */
export function initSessionLastVisit(nowMs = Date.now(), storage: StorageLike | null = defaultStorage()): number | null {
  if (!storage) return null;
  let prevTs: number | null = null;
  try {
    const raw = storage.getItem(LAST_VISIT_STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= nowMs + 60_000) {
        prevTs = parsed;
      }
    }
    storage.setItem(LAST_VISIT_STORAGE_KEY, String(Math.floor(nowMs)));
  } catch {
    return prevTs;
  }
  return prevTs;
}

/** `localStorage`에서 읽은 기사 ID 목록 로드 (최대 1,000개) */
export function loadReadIds(storage: StorageLike | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(READ_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return clean.slice(-MAX_READ_IDS);
  } catch {
    return [];
  }
}

/** 기사 ID(및 클러스터 관련 기사 ID)를 읽음 목록에 추가하고 최근 1,000개로 유지해 저장한다 */
export function recordReadIds(
  currentIds: string[],
  idsToAdd: string[],
  storage: StorageLike | null = defaultStorage(),
): string[] {
  const filteredAdd = idsToAdd.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (filteredAdd.length === 0) return currentIds;

  const existingSet = new Set(currentIds);
  const additions = filteredAdd.filter((id) => !existingSet.has(id));
  if (additions.length === 0) return currentIds;

  const next = [...currentIds, ...additions].slice(-MAX_READ_IDS);
  if (storage) {
    try {
      storage.setItem(READ_IDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota/private mode errors
    }
  }
  return next;
}

/** 대표 기사 1장과 클러스터에 묶인 모든 관련 기사의 ID를 함께 반환 */
export function collectClusterItemIds(item: Pick<FeedItem, "id" | "relatedArticles">): string[] {
  const ids = [item.id];
  if (item.relatedArticles) {
    for (const r of item.relatedArticles) {
      if (r.id && !ids.includes(r.id)) ids.push(r.id);
    }
  }
  return ids;
}

export interface VisitDividerInfo {
  /** 화면 표시 배열(`displayedItems`)에서 마지막 새 기사의 인덱스. 이 카드 바로 아래에 구분선을 표시한다 */
  afterIndex: number;
  /** 마지막 방문 이후 새로 올라온 기사 수 */
  newCount: number;
  /** 새 소식 중 주요 이슈 수 */
  majorCount: number;
}

/**
 * 화면 표시 순서(`displayedItems`) 기준으로 마지막 방문(`lastVisitTs`) 이후 새 소식 경계를 계산한다.
 * - 새 소식이 1건 이상 있고, 그 아래에 이전 기사가 1건 이상 이어질 때만 마커 정보를 반환한다.
 * - 고중력 정렬로 새 소식이 상단에 모여 있을 때 마지막 새 기사 바로 아래에 위치한다.
 */
export function computeVisitDivider(
  displayedItems: FeedItem[],
  lastVisitTs: number | null,
  now: number,
): VisitDividerInfo | null {
  if (lastVisitTs === null || !Number.isFinite(lastVisitTs) || displayedItems.length < 2) return null;

  let newCount = 0;
  let majorCount = 0;
  let lastNewIndex = -1;

  for (let i = 0; i < displayedItems.length; i++) {
    const item = displayedItems[i];
    const ts = itemTimestampMs(item);
    if (ts > lastVisitTs) {
      newCount += 1;
      lastNewIndex = i;
      const major = item.is_major_issue ?? computeGravityMetrics(item, now).isMajorIssue;
      if (major) majorCount += 1;
    }
  }

  // 새 소식이 없거나, 모든 기사가 새 소식(아래에 이전 기사 없음)이면 구분선 미표시
  if (newCount === 0 || lastNewIndex < 0 || lastNewIndex >= displayedItems.length - 1) {
    return null;
  }

  return {
    afterIndex: lastNewIndex,
    newCount,
    majorCount,
  };
}

/** 구분선 라벨 문자열 생성 (한/영 대응) */
export function formatVisitDividerLabel(info: Pick<VisitDividerInfo, "newCount" | "majorCount">, lang: "ko" | "en" = "ko"): string {
  if (lang === "en") {
    const majorPart = info.majorCount > 0 ? ` · ${info.majorCount} major` : "";
    return `Caught up here · ${info.newCount} new since last visit${majorPart}`;
  }
  const majorPart = info.majorCount > 0 ? ` · 주요 이슈 ${info.majorCount}건` : "";
  return `여기까지 확인하셨습니다 · 마지막 방문 이후 새 소식 ${info.newCount}건${majorPart}`;
}
