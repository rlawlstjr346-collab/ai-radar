import type { Category, FeedItem } from "./types";

/** 상단 가로 탭 (초보자 친화 한글 분류) */
export type NewsTab = "all" | "bigtech" | "tools" | "social" | "builder" | "past" | "directory";

export const NEWS_TABS: ReadonlyArray<{ id: NewsTab; label: string }> = [
  { id: "all", label: "전체" },
  { id: "bigtech", label: "빅테크·세상 흐름" },
  { id: "tools", label: "바로 써보는 AI" },
  { id: "social", label: "X·커뮤니티 화제" },
  { id: "builder", label: "오픈소스·빌더" },
  { id: "past", label: "지난 주요 소식" },
  { id: "directory", label: "AI 도감" },
];

const TAB_CATEGORIES: Partial<Record<NewsTab, ReadonlySet<Category>>> = {
  bigtech: new Set<Category>(["industry", "research"]),
  tools: new Set<Category>(["llm_chat", "image_design", "video_audio"]),
  social: new Set<Category>(["social"]),
  builder: new Set<Category>(["dev"]),
};

export function itemsForTab(items: FeedItem[], tab: NewsTab): FeedItem[] {
  if (tab === "directory") return [];
  if (tab === "past") return items.filter((i) => i.lifecycle_status === "warm");
  const cats = TAB_CATEGORIES[tab];
  return items.filter((i) => i.lifecycle_status === "hot" && (!cats || cats.has(i.category)));
}

const FUTURE_SLACK_MS = 5 * 60_000;

/** 순수 시간순 기준 시각: 원문 발행 시각 → 없거나 미래로 잘못 파싱되면 수집 시각 */
export function itemTime(item: Pick<FeedItem, "published_at" | "created_at" | "fetched_at">, now: number): number {
  const pub = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  if (Number.isFinite(pub) && pub <= now + FUTURE_SLACK_MS) return Math.min(pub, now);
  const fallback = Date.parse(item.fetched_at ?? item.created_at);
  return Number.isFinite(fallback) ? Math.min(fallback, now) : 0;
}

/** 같은 사건을 다룬 매체 수 (웹 클러스터 · 워커 묶음 · 동일 URL 다중 포착 중 최댓값) */
export function coverage(item: FeedItem): number {
  return Math.max(1 + (item.relatedArticles?.length ?? 0), item.cluster_size ?? 1, item.source_count ?? 1);
}

export const hasImage = (item: FeedItem): boolean => Boolean(item.image_url);

export function newestFirst(items: FeedItem[], now: number): FeedItem[] {
  return items
    .map((item) => ({ item, t: itemTime(item, now) }))
    .sort((a, b) => b.t - a.t || a.item.id.localeCompare(b.item.id))
    .map((x) => x.item);
}

export interface FrontPageLayout {
  hero: FeedItem | null;
  side: FeedItem[];
  wire: FeedItem[];
  features: FeedItem[];
  stream: FeedItem[];
}

export const WIRE_COUNT = 6;
export const SIDE_COUNT = 2;
export const FEATURE_COUNT = 2;
const HERO_WINDOW_MS = 48 * 3_600_000;

/**
 * BBC식 1면 배치.
 * - 히어로: 48시간 안에서 가장 여러 매체가 동시에 다룬 사건 (동률이면 사진 보유 → 중요도 → 최신)
 * - 속보 와이어: 가중치 없이 순수 최신 시간순 6건
 * - 좌측 포토 2건 · 중단 포토 피처 2건: 사진이 있는 주요 기사
 * - 스트림: 위에 안 나온 나머지 전부 시간순
 */
export function buildFrontPage(items: FeedItem[], now: number): FrontPageLayout {
  if (items.length === 0) return { hero: null, side: [], wire: [], features: [], stream: [] };
  const chrono = newestFirst(items, now);
  const recent = chrono.filter((i) => now - itemTime(i, now) <= HERO_WINDOW_MS);
  const heroPool = recent.length > 0 ? recent : chrono;
  const hero = [...heroPool].sort(
    (a, b) =>
      coverage(b) - coverage(a) ||
      Number(hasImage(b)) - Number(hasImage(a)) ||
      b.importance_score - a.importance_score ||
      itemTime(b, now) - itemTime(a, now),
  )[0];

  const wire = chrono.filter((i) => i.id !== hero.id).slice(0, WIRE_COUNT);
  const used = new Set<string>([hero.id, ...wire.map((i) => i.id)]);

  const byWeight = chrono
    .filter((i) => !used.has(i.id))
    .sort((a, b) => coverage(b) - coverage(a) || b.importance_score - a.importance_score || itemTime(b, now) - itemTime(a, now));
  const side = [...byWeight.filter(hasImage), ...byWeight.filter((i) => !hasImage(i))].slice(0, SIDE_COUNT);
  for (const i of side) used.add(i.id);

  const features = chrono.filter((i) => !used.has(i.id) && hasImage(i)).slice(0, FEATURE_COUNT);
  for (const i of features) used.add(i.id);

  const stream = chrono.filter((i) => !used.has(i.id));
  return { hero, side, wire, features, stream };
}

/** 화면 위→아래 읽기 순서 (J/K 탐색) */
export function frontPageOrder(layout: FrontPageLayout): string[] {
  return [
    ...(layout.hero ? [layout.hero.id] : []),
    ...layout.wire.map((i) => i.id),
    ...layout.side.map((i) => i.id),
    ...layout.features.map((i) => i.id),
    ...layout.stream.map((i) => i.id),
  ];
}

const X_LIKE = new Set(["x", "bluesky", "threads"]);

/** 와이어·카드 출처 라벨 (X 는 'X 시그널') */
export function sourceLabel(item: Pick<FeedItem, "platform_id" | "author_handle">, platformName?: string): string {
  if (item.platform_id === "x") return item.author_handle ? `X 시그널 · ${item.author_handle}` : "X 시그널";
  if (X_LIKE.has(item.platform_id)) return platformName ?? item.platform_id;
  return platformName ?? item.platform_id;
}

/** `==` 형광 마커·여분 공백 없이 화면용 쉬운 요약 */
export function plainSummary(item: FeedItem): string {
  const raw = item.easy_summary_ko || item.what_ko || item.highlight_summary || item.context_ko || "";
  return raw.replace(/==/g, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * 워커가 묶은 동일 사건(related_refs)을 카드 1장으로 접는다.
 * 대표: 사진 보유 → 중요도 → 최신 순. 나머지는 relatedArticles 로 붙인다 (결정론적, SSR/CSR 일치).
 */
export function foldClusters(items: FeedItem[], now: number): FeedItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const group = [item, ...(item.related_refs ?? []).map((r) => byId.get(r.id)).filter((x): x is FeedItem => Boolean(x) && !seen.has(x!.id))];
    for (const g of group) seen.add(g.id);
    if (group.length === 1) {
      out.push(item);
      continue;
    }
    const [rep, ...rest] = [...group].sort(
      (a, b) =>
        Number(hasImage(b)) - Number(hasImage(a)) ||
        b.importance_score - a.importance_score ||
        itemTime(b, now) - itemTime(a, now) ||
        a.id.localeCompare(b.id),
    );
    out.push({ ...rep, relatedArticles: rest });
  }
  return out;
}
