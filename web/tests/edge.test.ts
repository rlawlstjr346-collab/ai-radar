import { describe, expect, it } from "vitest";

import { handleIngest, handleLiveFeedGet, resetMemo } from "../edge/api";
import type { D1Database, D1PreparedStatement } from "../edge/cf-types";
import { assembleFeed, chunkText, extractItemsInner, titleKey, urlKey } from "../edge/feed-store";
import { EDGE_SOURCES, koSentence, parseDate, parseFeed, runEdgeScan, validEdit } from "../edge/scan";

/** 엣지 코드가 쓰는 4가지 SQL 모양만 흉내 내는 메모리 D1 */
function fakeD1() {
  const rows = new Map<string, string>();
  const stats = { reads: 0, writes: 0, queries: 0 };
  const stmt = (sql: string, args: unknown[] = []): D1PreparedStatement => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async all<T>() {
      stats.queries += 1;
      const results = (args as string[]).filter((k) => rows.has(k)).map((k) => ({ k, v: rows.get(k)! }));
      stats.reads += results.length;
      return { results: results as T[] };
    },
    async run() {
      if (sql.startsWith("INSERT")) {
        rows.set(String(args[0]), String(args[1]));
        stats.writes += 1;
      } else if (sql.startsWith("DELETE")) {
        for (const k of [...rows.keys()]) if (k.startsWith("base:") && Number(k.slice(5)) >= Number(args[0])) rows.delete(k);
      }
      return {};
    },
  });
  const db: D1Database = {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      stats.queries += 1;
      for (const s of list) await s.run();
      return [];
    },
  };
  return { db, rows, stats };
}

const FEED = JSON.stringify({
  version: 1,
  generated_at: "2026-11-28T10:00:00Z",
  item_count: 2,
  items: [
    { id: "live-a", canonical_url: "https://www.aitimes.com/news/articleView.html?idxno=1", original_title: "가 기사", hook_title: "가" },
    { id: "live-b", canonical_url: "https://openai.com/index/b/", original_title: "B story", hook_title: "나" },
  ],
});

async function ingest(env: { DB: D1Database; FEED_INGEST_SECRET: string }, feed = FEED, secret = "s3cret") {
  const meta = JSON.stringify({ generated_at: "2026-11-28T10:00:00Z", count: 2, urls: [urlKey("https://openai.com/index/b/"), titleKey("가 기사 제목 아주 길게")] });
  return handleIngest(
    new Request("https://x.dev/api/live-feed/ingest", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: `${meta}\n${feed}` }),
    env,
    new Date("2026-11-28T10:01:00Z"),
  );
}

describe("엣지 D1 스냅샷 저장소", () => {
  it("items 배열 본문만 파싱 없이 잘라 조각 저장하고, 다시 이어 붙이면 유효한 JSON 이 된다", () => {
    const inner = extractItemsInner(FEED)!;
    expect(inner.startsWith("{")).toBe(true);
    const body = assembleFeed(
      { generated_at: "g", scanned_at: "s", base_generated_at: "g", base_chunks: 2, count: 2, edge_count: 1 },
      '{"id":"live-e1"}',
      chunkText(inner, 50).join(""),
    );
    const parsed = JSON.parse(body);
    expect(parsed.items.map((i: { id: string }) => i.id)).toEqual(["live-e1", "live-a", "live-b"]);
    expect(parsed.scanned_at).toBe("s");
  });

  it("ingest 는 비밀키 없으면 401, 있으면 메타 1 + 조각 + edge + seen 을 원자 기록하고 GET 이 1쿼리로 조립한다", async () => {
    const { db, stats } = fakeD1();
    const env = { DB: db, FEED_INGEST_SECRET: "s3cret" };
    expect((await ingest(env, FEED, "wrong")).status).toBe(401);
    const res = await ingest(env);
    expect(res.status).toBe(200);
    resetMemo();
    const before = stats.reads;
    const get = await handleLiveFeedGet(new Request("https://x.dev/api/live-feed"), env as never, Date.now());
    expect(get.headers.get("cache-control")).toContain("s-maxage=25");
    const body = await get.json();
    expect(body.items).toHaveLength(2);
    expect(stats.reads - before).toBeLessThanOrEqual(5);
  });

  it("since 이후 변경이 없으면 204 로 본문 없이 메타 1행만 읽는다", async () => {
    const { db, stats } = fakeD1();
    const env = { DB: db, FEED_INGEST_SECRET: "s3cret" };
    await ingest(env);
    resetMemo();
    const before = stats.reads;
    const res = await handleLiveFeedGet(new Request("https://x.dev/api/live-feed?since=2099-01-01T00:00:00Z"), env as never, Date.now());
    expect(res.status).toBe(204);
    expect(res.headers.get("x-scanned-at")).toBeTruthy();
    expect(stats.reads - before).toBe(1);
  });
});

describe("5분 엣지 스캐너", () => {
  it("시간대 없는 AI타임스 로컬 시각은 KST 로, 날짜만 있으면 null(첫 포착 시각)로 해석한다", () => {
    expect(new Date(parseDate("2026-11-28 18:31:30", "+09:00")!).toISOString()).toBe("2026-11-28T09:31:30.000Z");
    expect(parseDate("2026-11-28")).toBeNull();
    expect(new Date(parseDate("Sat, 28 Nov 2026 10:24:40 GMT")!).toISOString()).toBe("2026-11-28T10:24:40.000Z");
  });

  it("구글 뉴스 RSS 에서 ' - 매체명' 접미사를 떼고 링크·발행시각·매체를 뽑는다", () => {
    const xml = `<rss><channel><item><title>오픈AI, 새 모델 공개 - 연합뉴스</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Sat, 28 Nov 2026 10:24:40 GMT</pubDate><source url="https://yna.co.kr">연합뉴스</source></item></channel></rss>`;
    const [e] = parseFeed(xml, EDGE_SOURCES[0]);
    expect(e.title).toBe("오픈AI, 새 모델 공개");
    expect(e.publisher).toBe("연합뉴스");
    expect(e.link).toBe("https://news.google.com/rss/articles/abc");
  });

  it("규칙 대화체·Gemini 검증", () => {
    expect(koSentence("정부가 AI 기본법 시행령을 확정했다")).toBe("정부가 AI 기본법 시행령을 확정했어요.");
    expect(validEdit({ title_ko: "새 모델이 나왔어요", summary: "작은 언어 모델이 새로 나왔어요. 값도 훨씬 싸졌어요." })).toBe(true);
    expect(validEdit({ title_ko: "[속보] 새 모델", summary: "작은 모델이 나왔어요." })).toBe(false);
    expect(validEdit({ title_ko: "データ 모델", summary: "작은 모델이 나왔어요." })).toBe(false);
  });

  it("신규 기사가 없으면 Gemini 0회 + D1 메타 1행만 쓰고, 영문 기사는 Gemini 실패 시 다음 주기로 미룬다", async () => {
    const { db, rows, stats } = fakeD1();
    const now = new Date("2026-11-28T10:30:00Z");
    const ko = `<rss><item><title>정부, AI 데이터센터 지원 확대 발표</title><link>https://www.aitimes.com/news/articleView.html?idxno=9</link><pubDate>2026-11-28 19:20:00</pubDate><description>정부가 AI 데이터센터 지원을 크게 확대한다.</description></item></rss>`;
    const en = `<rss><item><title>OpenAI ships a thing</title><link>https://techcrunch.com/2026/11/28/x/</link><pubDate>Sat, 28 Nov 2026 10:10:00 GMT</pubDate></item></rss>`;
    let geminiCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        geminiCalls += 1;
        return new Response("quota", { status: 429 });
      }
      if (url.includes("aitimes")) return new Response(ko);
      if (url.includes("techcrunch")) return new Response(en);
      return new Response("", { status: 500 });
    }) as typeof fetch;

    const r1 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, now, fetchImpl);
    expect(r1.published).toBe(1); // 한국어 기사는 규칙 대화체로 즉시 게시
    expect(r1.deferred).toBe(1); // 영문 기사는 보류
    expect(r1.subrequests).toBeLessThanOrEqual(15);
    const edge = JSON.parse(rows.get("edge")!);
    expect(edge[0].easy_summary_ko).toBe("정부가 AI 데이터센터 지원을 크게 확대해요.");
    expect(edge[0].published_at).toBe("2026-11-28T10:20:00.000Z");

    const callsAfterFirst = geminiCalls;
    const writesBefore = stats.writes;
    const quiet = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("aitimes")) return new Response(ko);
      return new Response("", { status: 500 });
    }) as typeof fetch;
    const r2 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:35:00Z"), quiet);
    expect(r2.fresh_new).toBe(0);
    expect(r2.gemini_calls).toBe(0);
    expect(geminiCalls).toBe(callsAfterFirst);
    expect(stats.writes - writesBefore).toBe(1); // 메타 1행만
  });
});
