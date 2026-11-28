import { describe, expect, it } from "vitest";

import { handleIngest, handleLiveFeedGet, resetMemo } from "../edge/api";
import type { D1Database, D1PreparedStatement } from "../edge/cf-types";
import samplePlatforms from "@/data/platforms.sample.json";

import { isAiItem, isAiSignal } from "../edge/ai-gate";
import { assembleFeed, chunkText, extractItemsInner, splitEven, titleKey, urlKey } from "../edge/feed-store";
import { EDGE_SOURCES, koSentence, parseDate, parseFeed, runEdgeScan, shardOf, sourcesFor, validEdit } from "../edge/scan";

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
    expect(get.headers.get("cache-control")).toContain("s-maxage=30");
    const body = await get.json();
    expect(body.items).toHaveLength(2);
    expect(stats.reads - before).toBeLessThanOrEqual(6); // meta 1 + edge 1 + base 4
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

  it("RSS 에서 ' - 매체명' 접미사를 떼고, 종합 피드는 AI 관련 글만 남긴다", () => {
    const geek = EDGE_SOURCES.find((s) => s.id === "geeknews")!;
    const xml = `<rss><channel><item><title><![CDATA[오픈AI, 새 에이전트 공개 - 연합뉴스]]></title><link>https://news.hada.io/topic?id=1</link><pubDate>Sat, 28 Nov 2026 10:24:40 GMT</pubDate><source url="https://yna.co.kr">연합뉴스</source></item><item><title>러스트 1.90 릴리스</title><link>https://news.hada.io/topic?id=2</link></item></channel></rss>`;
    const out = parseFeed(xml, geek);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("오픈AI, 새 에이전트 공개");
    expect(out[0].publisher).toBe("연합뉴스");
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
    const en = `<rss><item><title>OpenAI ships a thing</title><link>https://www.theverge.com/2026/11/28/x/</link><pubDate>Sat, 28 Nov 2026 10:10:00 GMT</pubDate></item></rss>`;
    let geminiCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        geminiCalls += 1;
        return new Response("quota", { status: 429 });
      }
      if (url.includes("aitimes")) return new Response(ko);
      if (url.includes("theverge")) return new Response(en);
      return new Response("", { status: 500 });
    }) as typeof fetch;

    const r1 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, now, fetchImpl);
    expect(r1.published).toBe(1); // 한국어 기사는 규칙 대화체로 즉시 게시
    expect(r1.deferred).toBe(1); // 영문 기사는 보류
    expect(r1.shard).toBe(0);
    expect(r1.subrequests).toBeLessThanOrEqual(18);
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
    const r2 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:45:00Z"), quiet); // 같은 Shard 0
    expect(r2.fresh_new).toBe(0);
    expect(r2.gemini_calls).toBe(0);
    expect(geminiCalls).toBe(callsAfterFirst);
    expect(stats.writes - writesBefore).toBe(1); // 메타 1행만
  });
});

describe("엣지 Gemini 재시도 상한", () => {
  it("영문 기사가 두 번 연속 실패하면 세 번째 주기부터는 Gemini 를 부르지 않는다", async () => {
    const { db } = fakeD1();
    const en = `<rss><item><title>OpenAI ships a thing</title><link>https://www.theverge.com/2026/11/28/y/</link><pubDate>Sat, 28 Nov 2026 10:10:00 GMT</pubDate></item></rss>`;
    let calls = 0;
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        calls += 1;
        return new Response("quota", { status: 429 });
      }
      return url.includes("theverge") ? new Response(en) : new Response("", { status: 500 });
    }) as typeof fetch;
    const r1 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:30:00Z"), f);
    const r2 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:45:00Z"), f);
    const r3 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T11:00:00Z"), f);
    expect([r1.deferred, r2.deferred, r3.fresh_new]).toEqual([1, 1, 0]);
    expect(r3.gemini_calls).toBe(0);
    expect(r1.failed_sources.some((s) => s.startsWith("aitimes:"))).toBe(true);
    expect(calls).toBe(6); // 2주기 × 모델 체인 3개, 이후 0
  });
});

describe("30개 엣지 수맥 3교대", () => {
  it("Shard 0·1·2 에 10개씩, 모든 소스가 실제 플랫폼 도감에 있고 https 주소다", () => {
    expect(EDGE_SOURCES).toHaveLength(30);
    expect(new Set(EDGE_SOURCES.map((s) => s.id)).size).toBe(30);
    expect([0, 1, 2].map((n) => sourcesFor(n).length)).toEqual([10, 10, 10]);
    const ids = new Set((samplePlatforms as Array<{ id: string }>).map((p) => p.id));
    for (const s of EDGE_SOURCES) {
      expect(ids.has(s.platform), s.platform).toBe(true);
      expect(s.url.startsWith("https://"), s.id).toBe(true);
    }
  });

  it("UTC 분 / 5 % 3 — 00·15·30·45분은 Shard 0", () => {
    const at = (m: number) => shardOf(new Date(Date.UTC(2026, 10, 28, 10, m)));
    expect([0, 5, 10, 15, 20, 25, 30, 45, 55].map(at)).toEqual([0, 1, 2, 0, 1, 2, 0, 0, 2]);
  });

  it("Shard 0 만 GitHub workflow_dispatch 를 부르고(204), 다른 조·토큰 없음·수동 측정은 부르지 않는다", async () => {
    const hits: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        hits.push(`${init?.method} ${JSON.parse(String(init?.body)).ref} ${(init?.headers as Record<string, string>).Authorization}`);
        return new Response(null, { status: 204 });
      }
      return new Response("", { status: 500 });
    }) as typeof fetch;
    const env = { DB: fakeD1().db, GH_DISPATCH_TOKEN: "t0k" };
    const r0 = await runEdgeScan(env, new Date("2026-11-28T10:15:00Z"), f);
    const r1 = await runEdgeScan(env, new Date("2026-11-28T10:20:00Z"), f);
    const manual = await runEdgeScan(env, new Date("2026-11-28T10:30:00Z"), f, { dispatch: false });
    const noToken = await runEdgeScan({ DB: fakeD1().db }, new Date("2026-11-28T10:45:00Z"), f);
    expect([r0.dispatch, r1.dispatch, manual.dispatch, noToken.dispatch]).toEqual(["204", null, null, null]);
    expect(hits).toEqual(["POST main Bearer t0k"]);
    expect(r0.subrequests).toBe(10 + 1 + 2);
    expect(r0.sources.map((s) => s.id)).toEqual(sourcesFor(0).map((s) => s.id));
  });

  it("HF·Juejin·V2EX JSON 을 공통 엔트리로 바꾼다", () => {
    const hf = EDGE_SOURCES.find((s) => s.id === "hf-papers")!;
    const papers = JSON.stringify([{ paper: { id: "2611.1", title: "LoopLM", summary: "A looped transformer.", submittedOnDailyAt: "2026-11-28T09:00:00.000Z" } }]);
    expect(parseFeed(papers, hf)[0]).toMatchObject({ title: "LoopLM", link: "https://huggingface.co/papers/2611.1", published: Date.parse("2026-11-28T09:00:00Z") });
    const models = EDGE_SOURCES.find((s) => s.id === "hf-models")!;
    const m = parseFeed(JSON.stringify([{ id: "org/Model-7B", likes: 9, pipeline_tag: "text-generation", tags: ["transformers", "license:mit"] }]), models)[0];
    expect(m.link).toBe("https://huggingface.co/org/Model-7B");
    expect(m.published).toBeNull(); // 트렌딩 → 처음 포착한 시각
    const jj = EDGE_SOURCES.find((s) => s.id === "juejin")!;
    const j = JSON.stringify({ data: [{ content: { content_id: "77", title: "Claude Code 智能体实战", ctime: "0" } }, { content: { content_id: "78", title: "压缩PNG不损失透明：只量化RGB", brief: "" } }] });
    expect(parseFeed(j, jj).map((e) => e.link)).toEqual(["https://juejin.cn/post/77"]);
    const v2 = EDGE_SOURCES.find((s) => s.id === "v2ex")!;
    const v = JSON.stringify([{ title: "分享一个开源磁盘清理、文件搜索工具", url: "https://www.v2ex.com/t/1", content: "支持 AI 智能分类 大模型" }, { title: "做了个 AI 阅读器", url: "https://www.v2ex.com/t/2", created: 1795793797 }]);
    expect(parseFeed(v, v2).map((e) => e.link)).toEqual(["https://www.v2ex.com/t/2"]);
  });

  it("차단·안내 HTML(200)은 피드 성공으로 세지 않는다", async () => {
    const f = (async (input: RequestInfo | URL) =>
      String(input).includes("openai.com") ? new Response("<!DOCTYPE html><html><title>Welcome</title></html>") : new Response("", { status: 404 })) as typeof fetch;
    const r = await runEdgeScan({ DB: fakeD1().db }, new Date("2026-11-28T10:00:00Z"), f, { dispatch: false });
    expect(r.sources.find((s) => s.id === "openai")!.status).toBe("html");
    expect(r.fetched).toBe(0);
  });

  it("Gemini 가 ai:false 로 판정한 기사는 실리지 않고, 다음 주기에 다시 부르지 않는다", async () => {
    const { db, rows } = fakeD1();
    const en = `<rss><item><title>OpenAI-backed startup opens a new office</title><link>https://www.theverge.com/2026/11/28/z/</link><pubDate>Sat, 28 Nov 2026 10:10:00 GMT</pubDate></item></rss>`;
    let calls = 0;
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        calls += 1;
        return Response.json({ output_text: '[{"i":0,"ai":false,"title_ko":"","summary":"","vision":""}]' });
      }
      return url.includes("theverge") ? new Response(en) : new Response("", { status: 500 });
    }) as typeof fetch;
    const r1 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:30:00Z"), f);
    const r2 = await runEdgeScan({ DB: db, GEMINI_API_KEY: "k" }, new Date("2026-11-28T10:45:00Z"), f);
    expect([r1.non_ai_dropped, r1.published, r2.fresh_new, calls]).toEqual([1, 0, 0, 1]);
    expect(JSON.parse(rows.get("edge")!)).toEqual([]);
  });
});

describe("AI 순도 게이트", () => {
  it("제목에 AI 신호가 있으면 통과, 일반 IT·유틸리티·보안 글은 탈락", () => {
    for (const t of ["오픈AI, 새 에이전트 공개", "做了个 AI 浏览器插件", "Claude Code 활용법", "llms.txt の設置率", "Google DeepCrossAttention, 최대 3배 빠르게"]) {
      expect(isAiSignal(t), t).toBe(true);
    }
    for (const t of ["分享一个开源磁盘清理、文件搜索工具", "Atari Homebrew Awards 취소", "压缩PNG不损失透明：只量化RGB、alpha原样留的减色流程", "러스트 1.90 릴리스", "受够锁机软件收费，给安卓写了个免费无广的防冲动戒手机工具"]) {
      expect(isAiSignal(t), t).toBe(false);
    }
  });

  it("본문에 AI 가 한 번 스친 글은 탈락, 서로 다른 AI 신호가 2개 이상이면 통과, 네거티브 단서가 있으면 탈락", () => {
    expect(isAiSignal("새 노트 앱 출시", "요즘 AI 시대라지만 이 앱은 그냥 메모장이다")).toBe(false);
    expect(isAiSignal("주말에 만든 사이드 프로젝트", "LLM 으로 요약하고 에이전트가 일정까지 잡아 준다")).toBe(true);
    expect(isAiSignal("맥 정리 도구", "디스크 정리 — AI 추천, LLM 분류")).toBe(false);
  });

  it("AI 전문 매체·공식 블로그는 게이트 면제, 종합 IT 소스 아이템만 다시 검사한다", () => {
    expect(isAiItem({ platform_id: "openai", original_title: "Searching for distant planets" })).toBe(true);
    expect(isAiItem({ platform_id: "v2ex", original_title: "分享一个开源磁盘清理、文件搜索工具", title_ko: "맥 디스크 정리와 파일 검색 도구" })).toBe(false);
  });
});

describe("200건 피드 4행 분할", () => {
  it("항상 4개 이하 행으로 고르게 나누고 이어 붙이면 원문과 같다", () => {
    const inner = Array.from({ length: 200 }, (_, i) => JSON.stringify({ id: `live-${i}`, title_ko: "한국어 제목".repeat(20) })).join(",");
    const parts = splitEven(inner);
    expect(parts).toHaveLength(4);
    expect(parts.join("")).toBe(inner);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(Math.ceil(inner.length / 4));
  });

  it("ingest 는 엣지 행에 남은 비AI 아이템을 함께 걷어낸다", async () => {
    const { db, rows } = fakeD1();
    rows.set("edge", JSON.stringify([
      { canonical_url: "https://www.v2ex.com/t/9", platform_id: "v2ex", original_title: "分享一个开源磁盘清理、文件搜索工具" },
      { canonical_url: "https://www.v2ex.com/t/10", platform_id: "v2ex", original_title: "做了个 AI 浏览器插件" },
    ]));
    const res = await ingest({ DB: db, FEED_INGEST_SECRET: "s3cret" });
    expect(res.status).toBe(200);
    expect(JSON.parse(rows.get("edge")!).map((it: { canonical_url: string }) => it.canonical_url)).toEqual(["https://www.v2ex.com/t/10"]);
  });
});
