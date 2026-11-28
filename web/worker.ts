/**
 * Cloudflare Worker 진입점 — OpenNext(Next.js) 핸들러 앞에 초경량 엣지 경로를 둔다.
 * - GET  /api/live-feed         : D1 스냅샷 조립 응답 (Next 서버를 깨우지 않음 → CPU 최소)
 * - POST /api/live-feed/ingest  : 15분 심층 파이프라인 결과 원자 업서트
 * - POST /api/live-feed/scan    : 운영자 수동 샤드 실측 (?shard=0|1|2&dispatch=1, Bearer FEED_INGEST_SECRET)
 * - scheduled (*\/5 * * * *)    : 5분 엣지 속보 스캔 (30개 소스 3교대, Shard 0 은 GitHub 심층 파이프라인 정각 호출)
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- 빌드 전에는 파일이 없고 빌드 후에는 있어서 expect-error 를 쓸 수 없다
// @ts-ignore -- `.open-next/worker.js` 는 opennextjs-cloudflare build 가 생성한다
import { default as nextHandler } from "./.open-next/worker.js";

import { authorized, handleIngest, handleLiveFeedGet } from "./edge/api";
import type { EdgeEnv, ExecutionContextLike, ScheduledController } from "./edge/cf-types";
import { runEdgeScan } from "./edge/scan";

type Env = EdgeEnv & Record<string, unknown>;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/live-feed" && (request.method === "GET" || request.method === "HEAD")) {
      return handleLiveFeedGet(request, env);
    }
    if (pathname === "/api/live-feed/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }
    if (pathname === "/api/live-feed/scan" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
      const q = new URL(request.url).searchParams;
      const shard = Number(q.get("shard"));
      const report = await runEdgeScan(env, new Date(), fetch, {
        shard: shard === 0 || shard === 1 || shard === 2 ? shard : undefined,
        dispatch: q.get("dispatch") === "1",
      });
      return Response.json(report);
    }
    return nextHandler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(
      runEdgeScan(env, new Date(controller.scheduledTime)).then((r) => console.log(JSON.stringify({ edge_scan: r }))),
    );
  },
};

export default worker;
