import { CATEGORY_ORDER } from "./categories";
import { computeGravityMetrics, isBuoyantHighGravity, isClusterRead, warmGravityScore } from "./gravity";
import type { Category, FeedItem, Platform } from "./types";

export type CategoryFilter = Category | "all";

/** 메인 라이브 피드 최대 노출 수 / 한 번에 더 보여줄 수 / 상단 스포트라이트 수 */
export const HOT_LIMIT = 100;
export const PAGE_SIZE = 12;
export const SPOTLIGHT_COUNT = 2;
const FRESH_HOURS = 3;
/** 최근 12시간 이내 고중력 주요 이슈 상단 체류 슬롯 상한 (히어로 1번 아래) */
const MAX_BUOYANT_SLOTS = 5;

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

/** 실시간 레이더 최신성 컷오프(48시간) 및 미래 시각 오파싱 허용 오차(5분) */
const LIVE_FRESH_CUTOFF_HOURS = 48;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_CONSECUTIVE_SAME_SOURCE = 2;

/**
 * 실시간 레이더 최우선 정렬 키:
 *  - Tier 2: 정상 발행 시각(`published_at` 정규화 UTC)이 48시간 이내 → 무조건 최신 시각 내림차순
 *  - Tier 1: 정상 발행 시각이 48시간 초과(지연 수집 옛 기사) → 48시간 이내 최신 기사 뒤에서 최신순
 *  - Tier 0: 발행 시각 미상(`published_at === null`) 또는 미래 오파싱 → 항상 최하단
 */
function liveChronoKey(
  item: Pick<FeedItem, "importance_score" | "created_at"> & Partial<Pick<FeedItem, "id" | "published_at" | "fetched_at">>,
  now: number,
): [number, number, number] {
  const isLive = typeof item.id === "string" && item.id.startsWith("live-");
  const rawIso = isLive ? item.published_at : item.created_at;
  const parsed = rawIso ? Date.parse(rawIso) : Number.NaN;
  if (!Number.isNaN(parsed) && parsed <= now + FUTURE_TOLERANCE_MS) {
    const effectiveTs = Math.min(parsed, now);
    const ageH = Math.max(0, (now - effectiveTs) / 3_600_000);
    const tier = ageH <= LIVE_FRESH_CUTOFF_HOURS ? 2 : 1;
    return [tier, effectiveTs, Number(item.importance_score) || 0];
  }
  const fallbackTs = Date.parse(item.fetched_at ?? item.created_at) || 0;
  return [0, Math.min(fallbackTs, now), Number(item.importance_score) || 0];
}

/** 동일 출처가 연속 3개 이상 붙을 때만 최소 거리로 미세 인터리빙 (최신순 원칙 보존) */
export function interleaveMaxConsecutive(items: FeedItem[], maxRun = MAX_CONSECUTIVE_SAME_SOURCE): FeedItem[] {
  if (items.length <= maxRun) return items;
  const pool = [...items];
  const result: FeedItem[] = [];
  while (pool.length > 0) {
    const lastPlat = result.length > 0 ? result[result.length - 1].platform_id : null;
    let sameRun = 0;
    for (let i = result.length - 1; i >= 0 && result[i].platform_id === lastPlat; i--) {
      sameRun++;
    }
    if (lastPlat && sameRun >= maxRun && pool[0].platform_id === lastPlat) {
      const altIdx = pool.findIndex((x) => x.platform_id !== lastPlat);
      if (altIdx > 0) {
        result.push(pool.splice(altIdx, 1)[0]);
        continue;
      }
    }
    result.push(pool.shift()!);
  }
  return result;
}

export interface HotFeedOptions {
  /** 이미 읽은 기사 ID 집합 — 읽은 기사는 12시간 고중력 상단 부력을 해제해 고착을 방지한다 */
  readIds?: ReadonlySet<string>;
}

function enrichGravity(item: FeedItem, now: number): FeedItem {
  const m = computeGravityMetrics(item, now);
  return {
    ...item,
    gravity_score: m.gravityScore,
    gravity_base_points: m.basePoints,
    is_major_issue: m.isMajorIssue,
  };
}

/**
 * 메인 라이브 피드:
 * 1) 1번 히어로 슬롯은 항상 가장 최근에 들어온 실시간 최신 미열람 기사를 배치(실시간 속보감 보장)
 * 2) 최근 12시간 이내 미열람 고중력(High-Gravity) 주요 이슈는 HN 중력 점수 순으로 상단권 체류력 부여(시차 방어)
 * 3) 12시간이 지나거나 이미 읽은 기사는 상단 부력을 해제해 고착 현상 방지
 * 4) 나머지는 최신 발행·포착 시각 내림차순 + 3연속 동일 출처만 미세 인터리빙
 */
export function hotFeed(
  items: FeedItem[],
  category: CategoryFilter,
  now: number,
  query = "",
  names?: Map<string, string>,
  options?: HotFeedOptions,
): FeedItem[] {
  const readIds = options?.readIds;
  const filtered = items
    .filter((i) => i.lifecycle_status === "hot")
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => matchesQuery(i, query, names?.get(i.platform_id)))
    .map((raw) => {
      const enriched = enrichGravity(raw, now);
      const metrics = computeGravityMetrics(enriched, now);
      const key = liveChronoKey(enriched, now);
      return { item: enriched, metrics, key };
    });

  const tier2 = filtered
    .filter((x) => x.key[0] === 2)
    .sort((a, b) => b.key[1] - a.key[1] || b.metrics.gravityScore - a.metrics.gravityScore || b.key[2] - a.key[2]);
  const tierRest = filtered
    .filter((x) => x.key[0] < 2)
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.metrics.gravityScore - a.metrics.gravityScore);

  const ordered: FeedItem[] = [];
  if (tier2.length > 0) {
    // ① 1번 히어로 슬롯: 가장 최근 실시간 미열람 기사 (모두 읽었으면 최신 1번)
    const heroIdx = readIds ? tier2.findIndex((x) => !isClusterRead(x.item, readIds)) : 0;
    const pickedHeroIdx = heroIdx >= 0 ? heroIdx : 0;
    const hero = tier2[pickedHeroIdx];
    ordered.push(hero.item);

    const remaining = tier2.filter((_, idx) => idx !== pickedHeroIdx);

    // ② 최근 12시간 이내 미열람 고중력 주요 이슈 상단 체류 (시차로 해외 빅테크 발표가 파묻히지 않게 방어)
    const buoyantAll = remaining
      .filter((x) => isBuoyantHighGravity(x.item, x.metrics, readIds))
      .sort((a, b) => b.metrics.gravityScore - a.metrics.gravityScore || b.key[1] - a.key[1]);
    const buoyantTop = buoyantAll.slice(0, MAX_BUOYANT_SLOTS);
    const buoyantIds = new Set(buoyantTop.map((x) => x.item.id));

    for (const b of buoyantTop) ordered.push(b.item);
    for (const r of remaining) {
      if (!buoyantIds.has(r.item.id)) ordered.push(r.item);
    }
  }

  for (const r of tierRest) ordered.push(r.item);

  return interleaveMaxConsecutive(ordered, MAX_CONSECUTIVE_SAME_SOURCE).slice(0, HOT_LIMIT);
}

/** 지난 주요 소식: warm(8~30일), HN 중력 체급 점수 순 */
export function pastFeed(
  items: FeedItem[],
  category: CategoryFilter,
  query = "",
  names?: Map<string, string>,
  now?: number,
): FeedItem[] {
  const warm = items
    .filter((i) => i.lifecycle_status === "warm")
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => matchesQuery(i, query, names?.get(i.platform_id)));

  // now 미지정 시 피드 내 최신 시각을 결정론적 기준점으로 사용해 SSR/CSR 일치 보장
  const refNow =
    now ??
    warm.reduce((acc, i) => {
      const t = Date.parse(i.published_at ?? i.created_at);
      return Number.isFinite(t) && t > acc ? t : acc;
    }, 0);

  return warm
    .map((raw) => {
      const item = enrichGravity(raw, refNow);
      return { item, score: warmGravityScore(item, now) };
    })
    .sort((a, b) => b.score - a.score || b.item.importance_score - a.item.importance_score)
    .map((x) => x.item);
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
  const tops = items.slice(0, EDITORIAL_TOP);
  return { lead: tops[0] ?? null, features: tops.slice(1), stream: items.slice(EDITORIAL_TOP) };
}

/** 화면 표시 순서의 id 목록 */
export function editorialOrder(layout: EditorialLayout): string[] {
  return [...(layout.lead ? [layout.lead] : []), ...layout.features, ...layout.stream].map((i) => i.id);
}
