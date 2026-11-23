import { NextResponse } from "next/server";

import { loadRadarData } from "@/lib/data";
import { hotFeed } from "@/lib/filter";
import { getHighlightSummary, getPlanningMeta } from "@/lib/reading-insights";
import { stripHighlightMarks } from "@/lib/highlight";

export const revalidate = 60;

/**
 * 하위 AI 기획팀 에이전트용 실시간 시그널 피드 엔드포인트.
 * GET /api/planning-feed?limit=50&category=dev&signal_type=new_product
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, Math.floor(limitParam))) : 60;
  const category = searchParams.get("category")?.trim() || "all";
  const signalType = searchParams.get("signal_type")?.trim() || "";

  const data = await loadRadarData();
  const names = new Map(data.platforms.map((p) => [p.id, p.name]));
  const now = Date.parse(data.generatedAt);

  const rankedHot = hotFeed(data.items, "all", now);
  const warmItems = data.items
    .filter((i) => i.lifecycle_status === "warm")
    .sort((a, b) => b.importance_score - a.importance_score);
  const pool = [...rankedHot, ...warmItems];

  const signals = pool
    .filter((item) => category === "all" || item.category === category)
    .map((item) => {
      const planning_meta = getPlanningMeta(item, names.get(item.platform_id));
      return {
        id: item.id,
        title_ko: item.title_ko ?? item.hook_title,
        original_title: item.original_title ?? item.hook_title,
        platform_id: item.platform_id,
        platform_name: names.get(item.platform_id) ?? item.platform_id,
        author_handle: item.author_handle ?? null,
        category: item.category,
        lifecycle_status: item.lifecycle_status,
        canonical_url: item.canonical_url,
        published_at: item.published_at,
        fetched_at: item.fetched_at ?? null,
        importance_score: item.importance_score,
        source_count: item.source_count,
        benefit_tag: item.benefit_tag,
        highlight_summary: stripHighlightMarks(getHighlightSummary(item)),
        planning_meta,
        entities: item.entities.map((e) => e.name),
      };
    })
    .filter((s) => !signalType || s.planning_meta.signal_type === signalType)
    .slice(0, limit);

  return NextResponse.json(
    {
      version: 1,
      generated_at: data.generatedAt,
      last_collected_at: data.lastCollectedAt ?? null,
      item_count: signals.length,
      signals,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
