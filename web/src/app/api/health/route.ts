import { NextResponse } from "next/server";

import { easyModeForDb, getSupabaseEnv, loadRadarData } from "@/lib/data";

/**
 * 개발자용 상태 점검 — 화면에는 내부 연결 상태를 쓰지 않고 여기서만 확인한다.
 * 비밀 값은 절대 내보내지 않고, 설정돼 있는지(true/false)만 알려 준다.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadRadarData();
  return NextResponse.json(
    {
      status: "ok",
      source: data.source,
      platforms: data.platforms.length,
      items: data.items.length,
      easy_original_mode: data.easyMode,
      config: {
        supabase_public: Boolean(getSupabaseEnv()),
        supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
        generator: easyModeForDb(),
      },
      notice: data.notice ?? null,
      generated_at: data.generatedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
