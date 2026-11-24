"use client";

import type { Category, Difficulty, EasyOriginal, Entity, FeedItem, Lifecycle, PlanningMeta, Term, UtilityTip } from "./types";

const REMOTE_LIVE_FEED_URL =
  "https://raw.githubusercontent.com/rlawlstjr346-collab/ai-radar/main/web/public/live-feed.json";
const LOCAL_LIVE_FEED_URL = "/live-feed.json";
const FETCH_TIMEOUT_MS = 5000;
const FIVE_MIN_MS = 300_000;

const VALID_CATEGORIES = new Set<Category>(["llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"]);
const VALID_URL_RE = /^https:\/\/[^/\s]+\.[^/\s]+/;
const BAD_HOST_RE = /example\.(com|org)|localhost|127\.0\.0\.1/i;

/** 클라이언트 실시간 수신으로 받은 원문 완독 해설 메모리 캐시 */
const clientEasyCache = new Map<string, EasyOriginal>();

export function getClientEasyOriginal(id: string): EasyOriginal | null {
  return clientEasyCache.get(id) ?? null;
}

export interface ClientLiveSnapshot {
  generatedAt: string | null;
  items: FeedItem[];
  source: "remote" | "local";
}

function coerceEasy(raw: unknown): EasyOriginal | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.sections) || !Array.isArray(v.watch_points)) return null;
  const sections = v.sections
    .map((s) => s as Record<string, unknown>)
    .filter((s) => typeof s?.heading === "string" && typeof s?.body === "string" && s.body.trim().length > 0)
    .map((s) => ({
      heading: String(s.heading),
      body: String(s.body),
      quote: typeof s.quote === "string" && s.quote.trim() ? s.quote : null,
    }));
  if (sections.length === 0) return null;
  return {
    sections,
    watch_points: v.watch_points.filter((w): w is string => typeof w === "string" && w.trim().length > 0).slice(0, 4),
    source_note: typeof v.source_note === "string" ? v.source_note : null,
    generated_at: typeof v.generated_at === "string" ? v.generated_at : null,
    model: typeof v.model === "string" ? v.model : null,
  };
}

function coerceUtilityTip(raw: unknown): UtilityTip | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const when_needed = typeof v.when_needed === "string" ? v.when_needed.trim() : "";
  const work_utility = typeof v.work_utility === "string" ? v.work_utility.trim() : "";
  const practical_tip = typeof v.practical_tip === "string" ? v.practical_tip.trim() : "";
  if (!when_needed || !work_utility || !practical_tip) return null;
  return { when_needed, work_utility, practical_tip };
}

function coercePlanningMeta(raw: unknown): PlanningMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const signal_type = typeof v.signal_type === "string" ? v.signal_type.trim() : "";
  const product_domain = typeof v.product_domain === "string" ? v.product_domain.trim() : "";
  const benchmark_point = typeof v.benchmark_point === "string" ? v.benchmark_point.trim() : "";
  const actionable_idea = typeof v.actionable_idea === "string" ? v.actionable_idea.trim() : "";
  if (!signal_type || !product_domain) return null;
  return { signal_type, product_domain, benchmark_point, actionable_idea };
}

function coerceClientItem(raw: unknown, validPlatformIds: Set<string>): { item: FeedItem; easy: EasyOriginal | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const platformId = typeof r.platform_id === "string" ? r.platform_id.trim() : "";
  const category = String(r.category ?? "") as Category;
  const url = typeof r.canonical_url === "string" ? r.canonical_url.trim() : "";
  const titleKo = typeof r.title_ko === "string" && r.title_ko.trim() ? r.title_ko.trim() : null;
  const originalTitle = typeof r.original_title === "string" && r.original_title.trim() ? r.original_title.trim() : null;
  const hookTitle = (typeof r.hook_title === "string" && r.hook_title.trim()) || titleKo || "";
  const publishedAt =
    typeof r.published_at === "string" && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at.trim() : null;
  const fetchedAt =
    typeof r.fetched_at === "string" && !Number.isNaN(Date.parse(r.fetched_at)) ? r.fetched_at.trim() : null;
  const createdAt = publishedAt ?? (typeof r.created_at === "string" ? r.created_at.trim() : "") ?? fetchedAt ?? "";

  if (!id || !validPlatformIds.has(platformId) || !VALID_CATEGORIES.has(category)) return null;
  if (!VALID_URL_RE.test(url) || BAD_HOST_RE.test(url) || !hookTitle || Number.isNaN(Date.parse(createdAt))) return null;

  const rawPlatforms = Array.isArray(r.source_platforms)
    ? r.source_platforms.filter((p): p is string => typeof p === "string" && validPlatformIds.has(p))
    : [];
  const sourcePlatforms = [platformId, ...rawPlatforms.filter((p) => p !== platformId)];
  const difficultyNum = Number(r.difficulty);
  const difficulty: Difficulty = difficultyNum === 1 || difficultyNum === 3 ? difficultyNum : 2;
  const lifecycle: Lifecycle = r.lifecycle_status === "warm" || r.lifecycle_status === "archived" ? r.lifecycle_status : "hot";

  const terms: Term[] = Array.isArray(r.terms)
    ? (r.terms as Array<Record<string, unknown>>)
        .filter((t) => typeof t?.term === "string" && typeof t?.easy === "string" && t.term.trim() && t.easy.trim())
        .map((t) => ({ term: String(t.term), easy: String(t.easy) }))
    : [];

  const entities: Entity[] = Array.isArray(r.entities)
    ? (r.entities as Array<Record<string, unknown>>)
        .filter((e) => typeof e?.name === "string" && e.name.trim())
        .map((e) => ({
          name: String(e.name),
          kind: typeof e.kind === "string" ? e.kind : "topic",
          tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
        }))
    : [];

  const easy = coerceEasy(r.easy_original);

  const item: FeedItem = {
    id,
    platform_id: platformId,
    category,
    canonical_url: url,
    thumbnail_url: typeof r.thumbnail_url === "string" && VALID_URL_RE.test(r.thumbnail_url) ? r.thumbnail_url : null,
    importance_score: Number.isFinite(Number(r.importance_score)) ? Number(r.importance_score) : 10,
    source_count: sourcePlatforms.length,
    source_platforms: sourcePlatforms,
    author_handle: typeof r.author_handle === "string" && r.author_handle.trim() ? r.author_handle.trim() : null,
    lifecycle_status: lifecycle,
    published_at: publishedAt,
    fetched_at: fetchedAt,
    created_at: createdAt,
    original_title: originalTitle,
    title_ko: titleKo,
    hook_title: hookTitle,
    benefit_tag: typeof r.benefit_tag === "string" && r.benefit_tag.trim() ? r.benefit_tag.trim() : null,
    context_ko: typeof r.context_ko === "string" && r.context_ko.trim() ? r.context_ko.trim() : null,
    what_ko: typeof r.what_ko === "string" && r.what_ko.trim() ? r.what_ko.trim() : null,
    analogy_ko: typeof r.analogy_ko === "string" && r.analogy_ko.trim() ? r.analogy_ko.trim() : null,
    why_ko: typeof r.why_ko === "string" && r.why_ko.trim() ? r.why_ko.trim() : null,
    caveats_ko: typeof r.caveats_ko === "string" && r.caveats_ko.trim() ? r.caveats_ko.trim() : null,
    highlight_summary: typeof r.highlight_summary === "string" && r.highlight_summary.trim() ? r.highlight_summary.trim() : null,
    utility_tip: coerceUtilityTip(r.utility_tip),
    planning_meta: coercePlanningMeta(r.planning_meta),
    difficulty,
    terms,
    entities,
    easy_original_ready: Boolean(easy) || Boolean(r.easy_original_ready),
  };

  return { item, easy };
}

function parseClientSnapshot(
  raw: Record<string, unknown>,
  validPlatformIds: Set<string>,
  source: "remote" | "local",
): ClientLiveSnapshot | null {
  const list = Array.isArray(raw?.items) ? raw.items : [];
  const items: FeedItem[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const entry of list) {
    const coerced = coerceClientItem(entry, validPlatformIds);
    if (!coerced) continue;
    if (seenIds.has(coerced.item.id) || seenUrls.has(coerced.item.canonical_url)) continue;
    seenIds.add(coerced.item.id);
    seenUrls.add(coerced.item.canonical_url);
    items.push(coerced.item);
    if (coerced.easy) clientEasyCache.set(coerced.item.id, coerced.easy);
  }
  if (items.length === 0) return null;
  const generatedAt =
    typeof raw?.generated_at === "string" && !Number.isNaN(Date.parse(raw.generated_at)) ? raw.generated_at : null;
  return { generatedAt, items, source };
}

async function fetchJsonWithTimeout(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 5분 단위 캐시 버스팅 쿼리를 붙인 GitHub Raw 최신 JSON 엔드포인트를 우선 수신하고,
 * 실패 시 로컬 정적 `/live-feed.json` 으로 안전 폴백한다.
 */
export async function fetchLatestLiveFeed(
  validPlatformIds: Set<string>,
  signal?: AbortSignal,
): Promise<ClientLiveSnapshot | null> {
  const bucket = Math.floor(Date.now() / FIVE_MIN_MS);
  const remoteRaw = await fetchJsonWithTimeout(`${REMOTE_LIVE_FEED_URL}?v=${bucket}`, signal);
  if (remoteRaw) {
    const parsed = parseClientSnapshot(remoteRaw, validPlatformIds, "remote");
    if (parsed) return parsed;
  }
  if (signal?.aborted) return null;
  const localRaw = await fetchJsonWithTimeout(`${LOCAL_LIVE_FEED_URL}?v=${bucket}`, signal);
  if (localRaw) {
    return parseClientSnapshot(localRaw, validPlatformIds, "local");
  }
  return null;
}

/** 최신 수신 스냅샷을 기존 피드(정적 샘플 포함)와 중복 없이 병합한다 (최신 live 우선). */
export function mergeLiveFeedItems(baseItems: FeedItem[], liveItems: FeedItem[]): FeedItem[] {
  if (liveItems.length === 0) return baseItems;
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const merged: FeedItem[] = [];
  // 이전 live-* 항목은 새 스냅샷으로 깔끔히 교체하고, 정적 샘플은 폴백용으로 뒤에 유지
  const staticFallback = baseItems.filter((i) => !i.id.startsWith("live-"));
  for (const item of [...liveItems, ...staticFallback]) {
    if (seenIds.has(item.id) || seenUrls.has(item.canonical_url)) continue;
    seenIds.add(item.id);
    seenUrls.add(item.canonical_url);
    merged.push(item);
  }
  return merged;
}
