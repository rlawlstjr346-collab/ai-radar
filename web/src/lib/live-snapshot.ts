import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import samplePlatforms from "@/data/platforms.sample.json";

import type { Category, Difficulty, EasyOriginal, Entity, FeedItem, Lifecycle, Platform, Term } from "./types";

const VALID_CATEGORIES = new Set<Category>(["llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"]);
const VALID_PLATFORM_IDS = new Set((samplePlatforms as Platform[]).map((p) => p.id));
const VALID_URL_RE = /^https:\/\/[^/\s]+\.[^/\s]+/;
const BAD_HOST_RE = /example\.(com|org)|localhost|127\.0\.0\.1/i;

export interface LiveSnapshot {
  generatedAt: string | null;
  items: FeedItem[];
  easyOriginals: Record<string, EasyOriginal>;
}

function resolveSnapshotPath(): string | null {
  const candidates = [
    join(process.cwd(), "public", "live-feed.json"),
    join(process.cwd(), "web", "public", "live-feed.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
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

function coerceItem(raw: unknown): { item: FeedItem; easy: EasyOriginal | null } | null {
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

  if (!id || !VALID_PLATFORM_IDS.has(platformId) || !VALID_CATEGORIES.has(category)) return null;
  if (!VALID_URL_RE.test(url) || BAD_HOST_RE.test(url) || !hookTitle || Number.isNaN(Date.parse(createdAt))) return null;

  const rawPlatforms = Array.isArray(r.source_platforms)
    ? r.source_platforms.filter((p): p is string => typeof p === "string" && VALID_PLATFORM_IDS.has(p))
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
    difficulty,
    terms,
    entities,
    easy_original_ready: Boolean(easy) || Boolean(r.easy_original_ready),
  };

  return { item, easy };
}

/**
 * web/public/live-feed.json 최신 스냅샷 로드.
 * 파일이 없거나 비어 있거나 손상돼도 예외 없이 빈 스냅샷을 반환한다.
 */
export function loadLiveSnapshot(explicitPath?: string): LiveSnapshot {
  const path = explicitPath ?? resolveSnapshotPath();
  if (!path || !existsSync(path)) return { generatedAt: null, items: [], easyOriginals: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const list = Array.isArray(raw?.items) ? raw.items : [];
    const items: FeedItem[] = [];
    const easyOriginals: Record<string, EasyOriginal> = {};
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    for (const entry of list) {
      const coerced = coerceItem(entry);
      if (!coerced) continue;
      if (seenIds.has(coerced.item.id) || seenUrls.has(coerced.item.canonical_url)) continue;
      seenIds.add(coerced.item.id);
      seenUrls.add(coerced.item.canonical_url);
      items.push(coerced.item);
      if (coerced.easy) easyOriginals[coerced.item.id] = coerced.easy;
    }
    const generatedAt = typeof raw?.generated_at === "string" && !Number.isNaN(Date.parse(raw.generated_at)) ? raw.generated_at : null;
    return { generatedAt, items, easyOriginals };
  } catch {
    return { generatedAt: null, items: [], easyOriginals: {} };
  }
}

/**
 * 최신 스냅샷(live-feed.json)과 기본 내장 피드(118건)를 중복 없이 병합한다.
 * 같은 canonical_url 이나 id 가 겹치면 최신 스냅샷이 우선한다.
 */
export function mergeWithLiveSnapshot(baseItems: FeedItem[], liveItems: FeedItem[]): FeedItem[] {
  if (liveItems.length === 0) return baseItems;
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const merged: FeedItem[] = [];
  for (const item of [...liveItems, ...baseItems]) {
    if (seenIds.has(item.id) || seenUrls.has(item.canonical_url)) continue;
    seenIds.add(item.id);
    seenUrls.add(item.canonical_url);
    merged.push(item);
  }
  return merged;
}
