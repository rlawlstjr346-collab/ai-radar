import { NextResponse } from "next/server";

import samplePlatforms from "@/data/platforms.sample.json";
import bundledPlanning from "../../../../public/data/planning-feed.json";
import type { Platform } from "@/lib/types";

// KV·ISR 없이 요청마다 경량 처리: 15분 주기로 갱신되는 정적 planning-feed.json(GitHub Raw, 실패 시 같은 배포의 정적 파일)을
// 읽어(실패·테스트 시 빌드에 번들된 같은 파일) 필터만 적용한다 (전체 화면 데이터 재계산 없음 → Worker CPU 한도 1102 회피).
export const dynamic = "force-dynamic";

const REMOTE_PLANNING_URL =
  "https://raw.githubusercontent.com/rlawlstjr346-collab/ai-radar/main/web/public/data/planning-feed.json";
const FETCH_TIMEOUT_MS = 3500;
const NAMES = new Map((samplePlatforms as Platform[]).map((p) => [p.id, p.name]));

type Signal = Record<string, unknown> & { category?: string; platform_id?: string; planning_meta?: { signal_type?: string } };

async function fetchJson(url: string): Promise<{ generated_at?: string; signals?: Signal[] } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as { generated_at?: string; signals?: Signal[] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, Math.floor(limitParam))) : 60;
  const category = searchParams.get("category")?.trim() || "all";
  const signalType = searchParams.get("signal_type")?.trim() || "";

  const offline = process.env.VITEST || process.env.DISABLE_REMOTE_LIVE_FEED === "1";
  const remote = offline ? null : await fetchJson(REMOTE_PLANNING_URL);
  const bundled = bundledPlanning as { generated_at?: string; signals?: Signal[] };
  const feed = remote && Array.isArray(remote.signals) && remote.signals.length > 0 ? remote : bundled;
  const all = Array.isArray(feed?.signals) ? feed.signals : [];
  const signals = all
    .filter((s) => category === "all" || s.category === category)
    .filter((s) => !signalType || s.planning_meta?.signal_type === signalType)
    .slice(0, limit)
    .map((s) => ({ ...s, platform_name: NAMES.get(String(s.platform_id)) ?? s.platform_id }));

  return NextResponse.json(
    {
      version: 1,
      generated_at: feed?.generated_at ?? null,
      last_collected_at: feed?.generated_at ?? null,
      item_count: signals.length,
      signals,
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
  );
}
