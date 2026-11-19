import { CATEGORY_ORDER } from "./categories";
import type { Category, FeedItem, Platform } from "./types";

export type CategoryFilter = Category | "all";

/** 메인 라이브 피드 최대 노출 수 / 한 번에 더 보여줄 수 / 상단 스포트라이트 수 */
export const HOT_LIMIT = 60;
export const PAGE_SIZE = 12;
export const SPOTLIGHT_COUNT = 2;
const FRESH_HOURS = 3;

export function filterItems(items: FeedItem[], category: CategoryFilter, beginnerOnly: boolean): FeedItem[] {
  return items
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => !beginnerOnly || i.difficulty === 1)
    .sort((a, b) => b.importance_score - a.importance_score);
}

export function ageHours(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now - t) / 3_600_000);
}

/** 신선도 중력 정렬 — DB 함수 hot_rank_score 와 같은 식: importance / (수집 후 경과시간h + 2)^1.5 */
export function hotRankScore(item: Pick<FeedItem, "importance_score" | "created_at">, now: number): number {
  return Math.max(0, item.importance_score) / Math.pow(ageHours(item.created_at, now) + 2, 1.5);
}

/** 메인 라이브 피드: hot 만, 신선도 중력 순, 최대 HOT_LIMIT 개 */
export function hotFeed(items: FeedItem[], category: CategoryFilter, beginnerOnly: boolean, now: number): FeedItem[] {
  return items
    .filter((i) => i.lifecycle_status === "hot")
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => !beginnerOnly || i.difficulty === 1)
    .map((i) => [i, hotRankScore(i, now)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, HOT_LIMIT)
    .map(([i]) => i);
}

/** 지난 주요 소식: warm(8~30일), 중요도 순 */
export function pastFeed(items: FeedItem[], category: CategoryFilter, beginnerOnly: boolean): FeedItem[] {
  return filterItems(
    items.filter((i) => i.lifecycle_status === "warm"),
    category,
    beginnerOnly,
  );
}

/** 3시간 이내 유입분은 NEW / N시간 전, 그 외엔 날짜 */
export function freshness(iso: string, now: number): { label: string; fresh: boolean } {
  const h = ageHours(iso, now);
  if (h < 1) return { label: "NEW", fresh: true };
  if (h < FRESH_HOURS) return { label: `${Math.floor(h)}시간 전`, fresh: true };
  return { label: formatDate(iso), fresh: false };
}

export function groupPlatforms(platforms: Platform[], category: CategoryFilter): Array<[Category, Platform[]]> {
  const order: Record<string, number> = { active: 0, paused: 1, directory_only: 2 };
  return CATEGORY_ORDER.filter((c) => category === "all" || c === category)
    .map((c): [Category, Platform[]] => [
      c,
      platforms
        .filter((p) => p.category === c)
        .sort((a, b) => order[a.collect_status] - order[b.collect_status] || a.name.localeCompare(b.name)),
    ])
    .filter(([, list]) => list.length > 0);
}

export function recentForPlatform(items: FeedItem[], platformId: string, limit = 3): FeedItem[] {
  return items
    .filter((i) => i.platform_id === platformId)
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .slice(0, limit);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
