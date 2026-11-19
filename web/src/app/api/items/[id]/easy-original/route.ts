import { NextResponse } from "next/server";

import { getEasyOriginal } from "@/lib/easy-original";

// 요청마다 DB 캐시를 확인해야 하므로 정적 생성하지 않는다
export const dynamic = "force-dynamic";
// 첫 생성(원문 가져오기 + LLM 1회)이 길어질 수 있어 여유를 둔다 (Vercel 등 서버리스용)
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await getEasyOriginal(id);
  return NextResponse.json(result.body, {
    status: result.httpStatus,
    headers: {
      "Cache-Control": result.body.status === "ready" ? "public, max-age=300, stale-while-revalidate=3600" : "no-store",
    },
  });
}
