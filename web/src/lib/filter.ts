import { CATEGORY_ORDER } from "./categories";
import type { Category, FeedItem, Platform } from "./types";

export type CategoryFilter = Category | "all";

/** 메인 라이브 피드 최대 노출 수 / 한 번에 더 보여줄 수 / 상단 스포트라이트 수 */
export const HOT_LIMIT = 100;
export const PAGE_SIZE = 12;
export const SPOTLIGHT_COUNT = 2;
const FRESH_HOURS = 3;

/** 키워드 검색: 공백으로 나눈 모든 단어가 제목·이득 칩·요약·기술 태그·용어·플랫폼명 어딘가에 있으면 통과 */
export function matchesQuery(item: FeedItem, query: string, platformName?: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    item.hook_title,
    item.benefit_tag,
    item.context_ko,
    item.what_ko,
    item.analogy_ko,
    item.why_ko,
    item.caveats_ko,
    platformName,
    item.platform_id,
    ...item.entities.flatMap((e) => [e.name, ...e.tags]),
    ...item.terms.map((t) => t.term),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

export function filterItems(items: FeedItem[], category: CategoryFilter, query = "", names?: Map<string, string>): FeedItem[] {
  return items
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => matchesQuery(i, query, names?.get(i.platform_id)))
    .sort((a, b) => b.importance_score - a.importance_score);
}

export function ageHours(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now - t) / 3_600_000);
}

/** 신선도 중력 정렬 — DB 함수 hot_rank_score 와 같은 식: importance / (경과시간h + 2)^1.5
 *  live-feed.json 의 실제 최신 기사(최근 24~48시간)는 정적 샘플 기사보다 1면 상단에 우선 노출된다. */
export function hotRankScore(
  item: Pick<FeedItem, "importance_score" | "created_at"> & Partial<Pick<FeedItem, "id" | "published_at">>,
  now: number,
): number {
  const isLive = typeof item.id === "string" && item.id.startsWith("live-");
  const baseIso = isLive && item.published_at ? item.published_at : item.created_at;
  const age = ageHours(baseIso, now);
  if (isLive && item.published_at === null) {
    return (Math.max(0, item.importance_score) / Math.pow(Math.max(age, 36) + 2, 1.5)) * 0.5;
  }
  const base = Math.max(0, item.importance_score) / Math.pow(age + 2, 1.5);
  if (isLive) {
    if (age <= 24) return base * 3.0;
    if (age <= 48) return base * 2.0;
    return base * 1.25;
  }
  return base;
}

/** 메인 라이브 피드: hot 만, 신선도 중력 순, 최대 HOT_LIMIT 개 */
export function hotFeed(
  items: FeedItem[],
  category: CategoryFilter,
  now: number,
  query = "",
  names?: Map<string, string>,
): FeedItem[] {
  return items
    .filter((i) => i.lifecycle_status === "hot")
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => matchesQuery(i, query, names?.get(i.platform_id)))
    .map((i) => [i, hotRankScore(i, now)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, HOT_LIMIT)
    .map(([i]) => i);
}

/** 지난 주요 소식: warm(8~30일), 중요도 순 */
export function pastFeed(items: FeedItem[], category: CategoryFilter, query = "", names?: Map<string, string>): FeedItem[] {
  return filterItems(
    items.filter((i) => i.lifecycle_status === "warm"),
    category,
    query,
    names,
  );
}

/** 한국 시간 기준 날짜 번호 (서버·브라우저 시간대가 달라도 같은 값 → hydration 일치) */
const KST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
function kstDayNumber(ms: number): number {
  return Date.parse(`${KST_DAY.format(new Date(ms))}T00:00:00Z`) / 86_400_000;
}

/** 마지막 자동 수집 시각 표시 (1시간 미만 'N분 전', 같은 날/24시간 이내 'HH:MM', 그 외 'MM.DD HH:MM') */
export function formatLastCollected(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hhmm = KST_TIME.format(new Date(t));
  if (minutes < 24 * 60) return hhmm;
  const [, mm, dd] = KST_DAY.format(new Date(t)).split("-");
  return `${mm}.${dd} ${hhmm}`;
}

/**
 * 카드 우상단 상대 시간 배지.
 *   1분 미만 '방금 전' · 1시간 미만 'N분 전' · 3시간 미만 'N시간 전'  → fresh(라이브 점 표시)
 *   같은 날 '오늘 · N시간 전' · 전날 '어제' · 7일 미만 'N일 전' · 그 이상은 날짜
 */
export function freshness(iso: string, now: number): { label: string; fresh: boolean } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { label: "", fresh: false };
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return { label: "방금 전", fresh: true };
  if (minutes < 60) return { label: `${minutes}분 전`, fresh: true };
  if (hours < FRESH_HOURS) return { label: `${hours}시간 전`, fresh: true };
  const dayDiff = kstDayNumber(now) - kstDayNumber(t);
  if (dayDiff <= 0) return { label: `오늘 · ${hours}시간 전`, fresh: false };
  if (dayDiff === 1) return { label: "어제", fresh: false };
  if (dayDiff < 7) return { label: `${dayDiff}일 전`, fresh: false };
  return { label: formatDate(iso), fresh: false };
}

/** 1면 TOP SPOTLIGHT 후보: 짧은 소셜 단문 제외, 원문 해독 가치가 있는 기사(원문 난이도 2+ 또는 주요 분야) */
const SPOTLIGHT_CATEGORIES = new Set<Category>(["research", "dev", "industry", "llm_chat"]);
export function isSpotlightEligible(item: FeedItem): boolean {
  return item.category !== "social" && (item.difficulty >= 2 || SPOTLIGHT_CATEGORIES.has(item.category));
}

/**
 * 이미 신선도 순으로 정렬된 목록에서 TOP SPOTLIGHT 를 고른다.
 * [원본 쉽게 읽기]가 준비된 기사를 먼저, 없으면 나머지 후보에서 — 첫 클릭이 '빈 해설'로 끝나지 않게.
 */
export function pickSpotlight(ranked: FeedItem[], count = SPOTLIGHT_COUNT): FeedItem[] {
  const eligible = ranked.filter(isSpotlightEligible);
  return [...eligible.filter((i) => i.easy_original_ready), ...eligible.filter((i) => !i.easy_original_ready)].slice(0, count);
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

/** 에디토리얼 1면 상단 기사 수: 리드 1 + 피처 2 (DESIGN.md §4) */
export const EDITORIAL_TOP = 3;

export interface EditorialLayout {
  /** ① 리드 스토리 (1위) */
  lead: FeedItem | null;
  /** ② 피처 페어 (2·3위) */
  features: FeedItem[];
  /** ③ 브리핑 스트림 (4위~) — 필터·검색 중에는 전부 여기 */
  stream: FeedItem[];
}

/**
 * 화면에 보이는 순서 그대로 1면을 나눈다. J/K 탐색도 [lead, ...features, ...stream] 순서를 쓴다.
 * editorial=false(분야 필터·검색·지난 소식)면 리드/피처 없이 스트림만.
 */
export function editorialLayout(items: FeedItem[], editorial: boolean): EditorialLayout {
  if (!editorial) return { lead: null, features: [], stream: items };
  const tops = pickSpotlight(items, EDITORIAL_TOP);
  const topIds = new Set(tops.map((i) => i.id));
  return { lead: tops[0] ?? null, features: tops.slice(1), stream: items.filter((i) => !topIds.has(i.id)) };
}

/** 화면 표시 순서의 id 목록 */
export function editorialOrder(layout: EditorialLayout): string[] {
  return [...(layout.lead ? [layout.lead] : []), ...layout.features, ...layout.stream].map((i) => i.id);
}
