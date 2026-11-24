import { NextResponse } from "next/server";

import { buildLiveFeedPayload } from "@/lib/live-harvester";

// Vercel 무료 플랜 안전 한도 내에서 3분 주기 CDN/ISR 자동 갱신
export const revalidate = 180;
export const maxDuration = 15;

/**
 * 실시간 라이브 보강 수집 & 즉시 병합 API.
 * GET /api/live-feed
 * 1) GitHub Raw 최신 live-feed.json (폴백: 로컬 public/live-feed.json) 로드
 * 2) 주요 글로벌·국내·중국·X 속보 창구에서 스냅샷 이후 신규 글을 3초 타임아웃 병렬 수집
 * 3) 중복 제거 + 무료 한국어 자동 번역 + 4단 요약·원본 쉽게 읽기 변환 후 최신 published_at 내림차순 병합 반환
 */
export async function GET() {
  const payload = await buildLiveFeedPayload();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300",
    },
  });
}
