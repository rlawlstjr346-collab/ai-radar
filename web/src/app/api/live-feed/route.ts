import { NextResponse } from "next/server";

import { buildLiveFeedPayload } from "@/lib/live-harvester";

// 빌드 시 1회 생성되는 정적 응답 (요청마다 Worker CPU 로 수집하지 않아 1102 한도 초과 0건).
// 실시간 최신본은 클라이언트가 GitHub Raw live-feed.json 에서 직접 받는다.
export const dynamic = "force-static";

/**
 * 실시간 라이브 보강 수집 & 즉시 병합 API.
 * GET /api/live-feed
 * 1) GitHub Raw 최신 live-feed.json (폴백: 로컬 public/live-feed.json) 로드
 * 2) 요청 시점 원격 수집은 하지 않는다 (15분 주기 GitHub Actions 수집이 최신성을 담당)
 */
export async function GET() {
  const payload = await buildLiveFeedPayload({ sources: [] });
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300",
    },
  });
}
