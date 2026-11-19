import "server-only";

import { createClient } from "@supabase/supabase-js";

import samplePlatforms from "@/data/platforms.sample.json";
import { buildSampleFeed } from "@/data/sample-feed";
import type { Category, Difficulty, EasyOriginalMode, Entity, FeedItem, Lifecycle, Platform, RadarData, Term } from "./types";

/** hot 은 최근 유입분을 넉넉히 받아 화면에서 신선도 정렬 후 최대 60개 노출, warm 은 중요도 상위 60개 */
const HOT_FETCH_LIMIT = 200;
const WARM_FETCH_LIMIT = 60;
const ITEM_COLUMNS =
  "id,platform_id,category,canonical_url,thumbnail_url,importance_score,source_count,lifecycle_status,published_at,created_at," +
  "summaries!inner(hook_title,benefit_tag,context_ko,what_ko,analogy_ko,why_ko,caveats_ko,difficulty,terms_json,extracted_entities," +
  // 해설 본문 전체 대신 '준비됐는지'만 알 수 있게 첫 섹션 제목만 가져온다
  "easy_ready:easy_original_json->sections->0->>heading)";

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

/** 서버에 생성기 키가 있으면 어떤 기사든 첫 클릭 때 해설을 만들 수 있다 */
export function easyModeForDb(): EasyOriginalMode {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && process.env.ANTHROPIC_API_KEY?.trim() ? "on_demand" : "cache_only";
}

export function sampleData(notice: string): RadarData {
  const now = Date.now();
  return {
    platforms: samplePlatforms as Platform[],
    // 샘플 수집 시각은 '지금' 기준으로 20분~3일 전에 고르게 분포 (라이브 피드 체감용)
    items: buildSampleFeed(now),
    source: "sample",
    generatedAt: new Date(now).toISOString(),
    easyMode: "sample",
    notice,
  };
}

/**
 * 화면에 필요한 데이터 전체.
 * - Supabase 환경변수가 비어 있으면 → 샘플(시드 22개 플랫폼 + 카드 8장)
 * - 연결/쿼리 실패해도 → 샘플 + 안내 문구 (화면이 깨지지 않게)
 * - 환경변수만 채우면 코드 수정 없이 실데이터로 전환
 */
export async function loadRadarData(): Promise<RadarData> {
  const env = getSupabaseEnv();
  if (!env) return sampleData("아직 데이터베이스가 연결되지 않아서 샘플 소식으로 보여드리고 있어요.");

  try {
    const sb = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    const [platformsRes, hotRes, warmRes] = await Promise.all([
      sb.from("platforms").select("*"),
      sb
        .from("items")
        .select(ITEM_COLUMNS)
        .eq("lifecycle_status", "hot")
        .order("created_at", { ascending: false })
        .limit(HOT_FETCH_LIMIT),
      sb
        .from("items")
        .select(ITEM_COLUMNS)
        .eq("lifecycle_status", "warm")
        .order("importance_score", { ascending: false })
        .limit(WARM_FETCH_LIMIT),
    ]);
    if (platformsRes.error) throw platformsRes.error;
    if (hotRes.error) throw hotRes.error;
    if (warmRes.error) throw warmRes.error;

    const platforms = (platformsRes.data ?? []) as Platform[];
    if (platforms.length === 0) return sampleData("데이터베이스에 플랫폼 시드가 아직 없어서 샘플로 보여드려요.");
    const items = ([...(hotRes.data ?? []), ...(warmRes.data ?? [])] as unknown as Record<string, unknown>[])
      .map(normalizeFeedRow)
      .filter((x): x is FeedItem => x !== null);
    return { platforms, items, source: "supabase", generatedAt: new Date().toISOString(), easyMode: easyModeForDb() };
  } catch (e) {
    console.error("[ai-radar] Supabase load failed, falling back to sample data:", e);
    return sampleData("데이터베이스 연결에 잠깐 문제가 있어서 샘플 소식으로 보여드리고 있어요.");
  }
}

/** PostgREST 응답 1행(items + summaries 임베드) → FeedItem. 요약 없는 행은 null */
export function normalizeFeedRow(row: Record<string, unknown>): FeedItem | null {
  const raw = row.summaries;
  const s = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!s || typeof s.hook_title !== "string") return null;

  const difficulty = Number(s.difficulty);
  return {
    id: String(row.id),
    platform_id: String(row.platform_id),
    category: row.category as Category,
    canonical_url: String(row.canonical_url),
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    importance_score: Number(row.importance_score ?? 0),
    source_count: Number(row.source_count ?? 1),
    lifecycle_status: (["hot", "warm", "archived"].includes(String(row.lifecycle_status))
      ? row.lifecycle_status
      : "hot") as Lifecycle,
    published_at: (row.published_at as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    hook_title: s.hook_title,
    benefit_tag: typeof s.benefit_tag === "string" && s.benefit_tag.trim() ? s.benefit_tag.trim() : null,
    context_ko: (s.context_ko as string | null) ?? null,
    what_ko: (s.what_ko as string | null) ?? null,
    analogy_ko: (s.analogy_ko as string | null) ?? null,
    why_ko: (s.why_ko as string | null) ?? null,
    caveats_ko: (s.caveats_ko as string | null) ?? null,
    difficulty: ([1, 2, 3].includes(difficulty) ? difficulty : 2) as Difficulty,
    terms: Array.isArray(s.terms_json) ? (s.terms_json as Term[]).filter((t) => t?.term && t?.easy) : [],
    entities: Array.isArray(s.extracted_entities) ? (s.extracted_entities as Entity[]).filter((e) => e?.name) : [],
    easy_original_ready: typeof s.easy_ready === "string" && s.easy_ready.length > 0,
  };
}
