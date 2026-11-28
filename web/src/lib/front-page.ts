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

/**
 * 원문 발행 시각이 검증된 기사인지 — 발행 시각을 모르는 기사(트렌딩 목록·날짜만 있는 글)는
 * 수집기가 published_at 을 수집 시각(fetched_at)과 똑같이 채우므로 둘이 같으면 '검증 안 됨'으로 본다.
 */
export function hasVerifiedPublishTime(item: Pick<FeedItem, "published_at" | "fetched_at">): boolean {
  const pub = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  if (!Number.isFinite(pub)) return false;
  const fetched = item.fetched_at ? Date.parse(item.fetched_at) : Number.NaN;
  return !Number.isFinite(fetched) || fetched !== pub;
}

/**
 * 속보 와이어: 발행 시각이 검증된 기사만 순수 최신순, 같은 출처는 최대 2건.
 * 검증된 기사가 6건이 안 될 때만 나머지 최신 기사로 빈칸을 채운다 (출처 상한은 그대로 지킨다).
 */
export function pickWire(chrono: FeedItem[], now: number, count = WIRE_COUNT, maxPerSource = WIRE_MAX_PER_SOURCE): FeedItem[] {
  const picked: FeedItem[] = [];
  const perSource = new Map<string, number>();
  const take = (pool: FeedItem[], capped: boolean) => {
    for (const i of pool) {
      if (picked.length >= count) return;
      if (picked.includes(i)) continue;
      const n = perSource.get(i.platform_id) ?? 0;
      if (capped && n >= maxPerSource) continue;
      picked.push(i);
      perSource.set(i.platform_id, n + 1);
    }
  };
  take(chrono.filter(hasVerifiedPublishTime), true);
  take(chrono, true);
  take(chrono, false);
  return newestFirst(picked, now);
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
/** 속보 와이어 상위 6칸 안에서 같은 출처는 최대 2건 (출처 다양성 가드레일) */
export const WIRE_MAX_PER_SOURCE = 2;
export const SIDE_COUNT = 2;
export const FEATURE_COUNT = 2;
/** 1면 포토 슬롯(히어로 + 좌측 2선) 신선도 창: 30시간 → 부족하면 48시간 → 전체 */
export const PHOTO_SLOT_WINDOWS_H: readonly number[] = [30, 48, Number.POSITIVE_INFINITY];
/** 경과 시간 감쇠 반감기 — 90분마다 점수가 절반 (몇 시간 지난 기사가 1면 포토 자리에 고착되지 않게) */
export const PHOTO_DECAY_HALF_LIFE_H = 1.5;
const PHOTO_SLOTS = 1 + SIDE_COUNT;

const ageHours = (item: FeedItem, now: number) => Math.max(0, (now - itemTime(item, now)) / 3_600_000);

/** 묶음 보도 수·중요도·사진 보유를 시간 감쇠로 눌러, 오래된 대형 묶음이 첫 포토 자리를 붙잡지 못하게 한다 */
export function photoSlotScore(item: FeedItem, now: number): number {
  const base = 1 + 0.75 * (coverage(item) - 1) + item.importance_score / 40;
  const decay = 0.5 ** (ageHours(item, now) / PHOTO_DECAY_HALF_LIFE_H);
  const explained = item.easy_summary_ko == null || item.easy_summary_ko.length > 0;
  return base * decay * (hasImage(item) ? 1.3 : 1) * (explained ? 1.2 : 1);
}

function byPhotoScore(items: FeedItem[], now: number): FeedItem[] {
  return items
    .map((item) => ({ item, s: photoSlotScore(item, now) }))
    .sort((a, b) => b.s - a.s || itemTime(b.item, now) - itemTime(a.item, now) || a.item.id.localeCompare(b.item.id))
    .map((x) => x.item);
}

/**
 * BBC식 1면 배치.
 * - 히어로 + 좌측 2선: 최근 30시간 기사 중 감쇠 점수 순 (모자랄 때만 48시간 → 전체로 넓힘)
 * - 속보 와이어: 원문 발행 시각이 검증된 기사만 순수 최신 시간순 6건 (같은 출처 최대 2건)
 * - 중단 포토 피처 2건: 사진이 있는 다음 최신 기사
 * - 스트림: 위에 안 나온 나머지 전부 시간순
 */
export function buildFrontPage(items: FeedItem[], now: number): FrontPageLayout {
  if (items.length === 0) return { hero: null, side: [], wire: [], features: [], stream: [] };
  const chrono = newestFirst(items, now);
  const within = (h: number) => chrono.filter((i) => ageHours(i, now) <= h);

  // 포토 슬롯은 검증된 사진이 있는 기사로만 채운다 (창 안에 사진 기사가 하나도 없을 때만 텍스트 히어로)
  const heroWindow =
    PHOTO_SLOT_WINDOWS_H.find((h) => within(h).filter(hasImage).length >= PHOTO_SLOTS) ?? Number.POSITIVE_INFINITY;
  const heroPool = within(heroWindow);
  const hero = byPhotoScore(heroPool.some(hasImage) ? heroPool.filter(hasImage) : heroPool, now)[0] ?? chrono[0];

  const wire = pickWire(chrono.filter((i) => i.id !== hero.id), now);
  const used = new Set<string>([hero.id, ...wire.map((i) => i.id)]);

  const side: FeedItem[] = [];
  for (const h of PHOTO_SLOT_WINDOWS_H) {
    for (const i of byPhotoScore(within(h).filter((x) => hasImage(x) && !used.has(x.id)), now)) {
      if (side.length >= SIDE_COUNT) break;
      side.push(i);
      used.add(i.id);
    }
    if (side.length >= SIDE_COUNT) break;
  }

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
  // 워커가 정제한 요약이 있으면(빈 문자열 포함) 그것만 쓴다 — 상투구 폴백 템플릿으로 되돌아가지 않게
  const raw = item.easy_summary_ko != null ? item.easy_summary_ko : item.what_ko || item.highlight_summary || item.context_ko || "";
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
