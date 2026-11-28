import { isAiItem, isHfUpload } from "./ai-gate";
import type { EdgeEnv } from "./cf-types";
import { restoreItem } from "./restore";
import {
  MAX_BASE_CHUNKS,
  SEEN_CAP,
  assembleFeed,
  edgeInnerOf,
  extractItemsInner,
  laterIso,
  parseMeta,
  readRows,
  splitEven,
  titleKey,
  upsert,
  urlKey,
  type MetaRow,
} from "./feed-store";

const CACHE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
  "Access-Control-Allow-Origin": "*",
};
const ISOLATE_TTL_MS = 30_000;

/** 같은 isolate 안에서는 30초 동안 조립된 응답을 재사용 → 몰려도 D1 읽기 0행 */
let memo: { at: number; meta: MetaRow; body: string } | null = null;

export function resetMemo(): void {
  memo = null;
}

function headersFor(meta: MetaRow): Record<string, string> {
  return { ...CACHE_HEADERS, "X-Generated-At": meta.generated_at, "X-Scanned-At": meta.scanned_at };
}

/** GET /api/live-feed[?since=ISO] — since 이후 변경이 없으면 204(본문 없음, 메타 1행만 읽음) */
export async function handleLiveFeedGet(request: Request, env: EdgeEnv, now = Date.now()): Promise<Response> {
  const since = new URL(request.url).searchParams.get("since");
  const unchanged = (meta: MetaRow) => since !== null && !Number.isNaN(Date.parse(since)) && Date.parse(meta.generated_at) <= Date.parse(since);

  if (memo && now - memo.at < ISOLATE_TTL_MS) {
    if (unchanged(memo.meta)) return new Response(null, { status: 204, headers: headersFor(memo.meta) });
    return new Response(memo.body, { headers: headersFor(memo.meta) });
  }

  if (since !== null) {
    const rows = await readRows(env.DB, ["meta"]);
    const meta = parseMeta(rows.get("meta"));
    if (!meta) return new Response(JSON.stringify({ error: "empty" }), { status: 503, headers: CACHE_HEADERS });
    if (unchanged(meta)) return new Response(null, { status: 204, headers: headersFor(meta) });
  }

  const keys = ["meta", "edge", ...Array.from({ length: MAX_BASE_CHUNKS }, (_, i) => `base:${i}`)];
  const rows = await readRows(env.DB, keys);
  const meta = parseMeta(rows.get("meta"));
  if (!meta) return new Response(JSON.stringify({ error: "empty" }), { status: 503, headers: CACHE_HEADERS });
  let baseInner = "";
  for (let i = 0; i < meta.base_chunks; i++) baseInner += rows.get(`base:${i}`) ?? "";
  const body = assembleFeed(meta, edgeInnerOf(rows.get("edge") ?? null), baseInner);
  memo = { at: now, meta, body };
  return new Response(body, { headers: headersFor(meta) });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface IngestMeta {
  generated_at: string;
  count: number;
  urls: string[];
}

/**
 * POST /api/live-feed/ingest  (Authorization: Bearer FEED_INGEST_SECRET)
 * 본문 = 1행 작은 메타 JSON + "\n" + live-feed.json 전체 텍스트. 큰 JSON 은 파싱하지 않고 조각으로 원자 저장한다.
 */
/** 운영자 전용 경로(ingest·수동 스캔)의 Bearer 비밀키 검사 */
export function authorized(request: Request, env: EdgeEnv): boolean {
  const secret = env.FEED_INGEST_SECRET ?? "";
  return Boolean(secret) && safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export async function handleIngest(request: Request, env: EdgeEnv, now = new Date()): Promise<Response> {
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });

  const text = await request.text();
  const nl = text.indexOf("\n");
  if (nl <= 0) return new Response("bad body", { status: 400 });
  let im: IngestMeta;
  try {
    im = JSON.parse(text.slice(0, nl)) as IngestMeta;
  } catch {
    return new Response("bad meta", { status: 400 });
  }
  const inner = extractItemsInner(text.slice(nl + 1));
  if (!inner || typeof im.generated_at !== "string" || !Array.isArray(im.urls)) return new Response("bad feed", { status: 400 });
  const chunks = splitEven(inner);
  if (chunks.length > MAX_BASE_CHUNKS) return new Response("feed too large", { status: 413 });

  const nowIso = now.toISOString();
  const rows = await readRows(env.DB, ["meta", "edge", "seen"]);
  const prev = parseMeta(rows.get("meta"));
  const baseKeys = new Set(im.urls);

  // 엣지 속보 중 이번 심층 스냅샷에 들어온 기사는 빼서 중복 노출을 막는다 (엣지 행은 40건 이하라 파싱 비용이 작다)
  let edge: Array<{ canonical_url?: string; original_title?: string; platform_id?: string }> = [];
  try {
    edge = JSON.parse(rows.get("edge") ?? "[]");
  } catch {
    edge = [];
  }
  // 엣지 속보 중 비AI 글·HF 업로드 로그도 이 시점에 함께 걷어내고, 억지 한글 음차(엠시피·이 년)는 원형으로 복원한다
  const keptEdge = edge
    .filter(
      (it) =>
        it.canonical_url &&
        !baseKeys.has(urlKey(it.canonical_url)) &&
        !baseKeys.has(titleKey(it.original_title ?? "")) &&
        isAiItem(it) &&
        !isHfUpload(it.canonical_url),
    )
    .map((it) => restoreItem(it));
  let seen: string[] = [];
  try {
    seen = JSON.parse(rows.get("seen") ?? "[]");
  } catch {
    seen = [];
  }
  const seenOut = Array.from(new Set([...im.urls, ...keptEdge.map((it) => urlKey(it.canonical_url!)), ...seen])).slice(0, SEEN_CAP);

  const meta: MetaRow = {
    // 내용이 바뀌었으니 단조 증가하는 '피드 갱신 시각'으로 찍는다 (since 폴링이 절대 놓치지 않게)
    generated_at: laterIso(nowIso, prev?.generated_at),
    scanned_at: laterIso(nowIso, prev?.scanned_at),
    base_generated_at: im.generated_at,
    base_chunks: chunks.length,
    count: Number(im.count) || 0,
    edge_count: keptEdge.length,
  };
  // 메타를 마지막에 써서, 중간 실패 시에도 이전 메타가 가리키는 조각 수만큼만 읽히게 한다 (batch 는 트랜잭션)
  const statements = [
    ...chunks.map((c, i) => upsert(env.DB, `base:${i}`, c, nowIso)),
    env.DB.prepare("DELETE FROM feed WHERE k LIKE 'base:%' AND CAST(substr(k, 6) AS INTEGER) >= ?").bind(chunks.length),
    upsert(env.DB, "edge", JSON.stringify(keptEdge), nowIso),
    upsert(env.DB, "seen", JSON.stringify(seenOut), nowIso),
    upsert(env.DB, "meta", JSON.stringify(meta), nowIso),
  ];
  await env.DB.batch(statements);
  resetMemo();
  return new Response(JSON.stringify({ ok: true, chunks: chunks.length, edge_kept: keptEdge.length, rows_written: statements.length }), {
    headers: { "Content-Type": "application/json" },
  });
}
