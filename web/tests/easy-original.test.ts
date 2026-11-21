import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_EASY_ORIGINAL } from "@/data/sample-easy-original";
import { SAMPLE_FEED } from "@/data/sample-feed";
import {
  candidateUrls,
  chooseSourceText,
  coerceEasyOriginal,
  fetchSourceText,
  getEasyOriginal,
  htmlToText,
  isFetchableUrl,
  MIN_RAW_BODY_CHARS,
  type EasyDeps,
} from "@/lib/easy-original";
import type { EasyOriginal } from "@/lib/types";

const BANNED = ["혁신적", "획기적", "패러다임", "게임 체인저", "게임체인저", "새로운 지평", "충격", "경악", "역대급", "미쳤다", "무조건"];
const EMOJI = /\p{Extended_Pictographic}/u;

describe("hooks & benefit tags (sample feed)", () => {
  it("benefit_tag is used sparingly (12+ cards, at most ~1 in 4), 16 chars or less, no emoji, no plain fact summaries", () => {
    const tagged = SAMPLE_FEED.filter((i) => i.benefit_tag);
    expect(tagged.length).toBeGreaterThanOrEqual(12);
    expect(tagged.length).toBeLessThanOrEqual(Math.ceil(SAMPLE_FEED.length * 0.25));
    expect(SAMPLE_FEED.find((i) => i.id === "sample-anthropic-ipo")?.benefit_tag).toBeNull();
    for (const i of tagged) {
      expect(i.benefit_tag!.length, `${i.id}: ${i.benefit_tag}`).toBeLessThanOrEqual(16);
      expect(EMOJI.test(i.benefit_tag!), i.id).toBe(false);
    }
  });

  it("hook titles avoid clickbait words and emoji", () => {
    for (const i of SAMPLE_FEED) {
      for (const b of BANNED) expect(i.hook_title.includes(b), `${i.id}: ${b}`).toBe(false);
      expect(EMOJI.test(i.hook_title), i.id).toBe(false);
      expect(i.hook_title.length, i.id).toBeLessThanOrEqual(48);
    }
  });
});

describe("sample easy-original data", () => {
  it("only references real sample cards and follows the shape", () => {
    const ids = new Set(SAMPLE_FEED.map((i) => i.id));
    const entries = Object.entries(SAMPLE_EASY_ORIGINAL);
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [id, easy] of entries) {
      expect(ids.has(id), id).toBe(true);
      expect(easy.sections.length, id).toBeGreaterThanOrEqual(5);
      expect(easy.watch_points.length, id).toBeGreaterThanOrEqual(2);
      expect(easy.watch_points.length, id).toBeLessThanOrEqual(3);
      for (const s of easy.sections) {
        expect(s.heading.trim().length, id).toBeGreaterThan(0);
        expect(s.body.length, `${id}: ${s.heading}`).toBeGreaterThan(80);
        if (s.quote) expect(s.quote.split(/\s+/).length, `${id}: ${s.quote}`).toBeLessThanOrEqual(25);
        for (const b of BANNED) expect(s.body.includes(b), `${id}: ${b}`).toBe(false);
      }
      expect(coerceEasyOriginal(easy)).not.toBeNull();
    }
  });

  it("the five most important sample cards that have originals are all covered", () => {
    const covered = SAMPLE_FEED.filter((i) => SAMPLE_EASY_ORIGINAL[i.id]).sort((a, b) => b.importance_score - a.importance_score);
    expect(covered.slice(0, 5).map((i) => i.id)).toEqual([
      "sample-anthropic-ipo",
      "sample-gemini-4-neon",
      "sample-google-ai-answers-traffic",
      "sample-windows-agent-telemetry",
      "sample-claude-black-hole-physics",
    ]);
  });
});

describe("getEasyOriginal — sample mode (no Supabase env)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the prepared walkthrough, a summary-based guide for others, 404 for unknown, 400 for bad ids", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const ready = await getEasyOriginal("sample-vllm-0-34");
    expect(ready.httpStatus).toBe(200);
    expect(ready.body.status).toBe("ready");

    // 손으로 쓴 해설이 없는 기사도 실패 대신 요약 기반 완독 가이드가 열린다
    const synth = await getEasyOriginal("sample-slack-moji");
    expect(synth.httpStatus).toBe(200);
    expect(synth.body).toMatchObject({ status: "ready", synthesized: true, source: "sample" });

    expect((await getEasyOriginal("sample-nope")).httpStatus).toBe(404);
    expect((await getEasyOriginal("../../etc/passwd")).httpStatus).toBe(400);
  });
});

// ── DB 모드: Supabase 클라이언트를 아주 얇은 가짜로 대체 ─────────────────────────────
const EASY: EasyOriginal = {
  sections: [{ heading: "h", body: "쉬운 설명", quote: "q" }],
  watch_points: ["w1", "w2"],
  source_note: "s",
};

function fakeAnon(row: Record<string, unknown> | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }),
    }),
  } as unknown as EasyDeps["anon"];
}

function fakeService() {
  const writes: Array<{ value: unknown; id: unknown }> = [];
  const client = {
    from: () => ({
      update: (value: unknown) => ({
        eq: async (_col: string, id: unknown) => {
          writes.push({ value, id });
          return { error: null };
        },
      }),
    }),
  } as unknown as NonNullable<EasyDeps["service"]>;
  return { client, writes };
}

const row = (easy: unknown) => ({
  id: "abc",
  original_title: "Title",
  canonical_url: "https://example.com/post",
  metrics_json: { _excerpt: "excerpt text" },
  summaries: { hook_title: "훅", easy_original_json: easy },
});

describe("getEasyOriginal — database mode", () => {
  it("returns the cached walkthrough instantly without calling the LLM", async () => {
    const generate = vi.fn();
    const r = await getEasyOriginal("abc", { anon: fakeAnon(row(EASY)), service: null, generate, hasLlmKey: false });
    expect(r.body).toMatchObject({ status: "ready", cached: true, source: "supabase" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("without generator keys it still answers with a summary-based guide (never a failure screen)", async () => {
    const generate = vi.fn();
    const r = await getEasyOriginal("abc", { anon: fakeAnon(row(null)), service: null, generate, hasLlmKey: true });
    expect(r.httpStatus).toBe(200);
    expect(r.body).toMatchObject({ status: "ready", synthesized: true, cached: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates once on first request, caches to summaries, and shares concurrent requests", async () => {
    const { client, writes } = fakeService();
    const generate = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return EASY;
    });
    const fetchText = vi.fn(async () => ({ text: "full original text ".repeat(20), truncated: false }));
    const deps: EasyDeps = { anon: fakeAnon(row(null)), service: client, generate, fetchText, hasLlmKey: true };

    const [a, b] = await Promise.all([getEasyOriginal("abc", deps), getEasyOriginal("abc", deps)]);
    expect(a.body).toMatchObject({ status: "ready", cached: false });
    expect(b.body).toEqual(a.body);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([{ value: { easy_original_json: EASY }, id: "abc" }]);
    expect(fetchText).toHaveBeenCalledWith("https://example.com/post");
  });

  it("when the page is blocked (403/429) it falls back to items.raw_body, then to a long-enough excerpt", async () => {
    const { client } = fakeService();
    const blocked = async () => null;
    const longRaw = "Release notes paragraph. ".repeat(30);

    const g1 = vi.fn(async () => EASY);
    await getEasyOriginal("abc", { anon: fakeAnon({ ...row(null), raw_body: longRaw }), service: client, generate: g1, fetchText: blocked, hasLlmKey: true });
    expect(g1).toHaveBeenCalledWith(expect.objectContaining({ sourceText: longRaw.trim(), sourceKind: "raw_body", truncated: true }));

    const longExcerpt = "Collected excerpt sentence. ".repeat(10);
    const g2 = vi.fn(async () => EASY);
    await getEasyOriginal("abc", {
      anon: fakeAnon({ ...row(null), raw_body: "too short", metrics_json: { _excerpt: longExcerpt } }),
      service: client, generate: g2, fetchText: blocked, hasLlmKey: true,
    });
    expect(g2).toHaveBeenCalledWith(expect.objectContaining({ sourceText: longExcerpt.trim(), sourceKind: "excerpt" }));

    const g3 = vi.fn(async () => EASY);
    const none = await getEasyOriginal("abc", { anon: fakeAnon(row(null)), service: client, generate: g3, fetchText: blocked, hasLlmKey: true });
    expect(none.httpStatus).toBe(200);                                   // 원문이 전부 막혀도 요약 기반 가이드
    expect(none.body).toMatchObject({ status: "ready", synthesized: true });
    expect(g3).not.toHaveBeenCalled();
  });

  it("chooseSourceText prefers the fetched page over stored bodies", () => {
    const page = { text: "page text", truncated: false };
    expect(chooseSourceText(page, "x".repeat(1000), "y".repeat(300))?.kind).toBe("page");
    expect(chooseSourceText(null, "x".repeat(MIN_RAW_BODY_CHARS), null)?.kind).toBe("raw_body");
    expect(chooseSourceText(null, "x".repeat(MIN_RAW_BODY_CHARS - 1), "y".repeat(250))?.kind).toBe("excerpt");
    expect(chooseSourceText(null, null, "short")).toBeNull();
  });

  it("falls back to a summary-based guide if generation throws, and 404 for unknown items", async () => {
    const { client } = fakeService();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = await getEasyOriginal("abc", {
      anon: fakeAnon(row(null)),
      service: client,
      generate: async () => {
        throw new Error("boom");
      },
      fetchText: async () => ({ text: "x".repeat(500), truncated: false }),
      hasLlmKey: true,
    });
    expect(failing.body).toMatchObject({ status: "ready", synthesized: true });
    spy.mockRestore();
    expect((await getEasyOriginal("zzz", { anon: fakeAnon(null) })).httpStatus).toBe(404);
  });
});

describe("source fetching safety", () => {
  it("only allows public http(s) URLs", () => {
    expect(isFetchableUrl("https://arxiv.org/abs/2611.1")).toBe(true);
    for (const bad of [
      "file:///etc/passwd",
      "http://localhost:3000",
      "http://127.0.0.1/x",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isFetchableUrl(bad), bad).toBe(false);
    }
  });

  it("tries the arXiv full-text HTML page before the abstract page", () => {
    expect(candidateUrls("https://arxiv.org/abs/2611.14848")).toEqual([
      "https://arxiv.org/html/2611.14848",
      "https://arxiv.org/abs/2611.14848",
    ]);
    expect(candidateUrls("https://arxiv.org/pdf/2611.14848v2")).toEqual([
      "https://arxiv.org/html/2611.14848",
      "https://arxiv.org/abs/2611.14848",
    ]);
    expect(candidateUrls("https://huggingface.co/papers/2611.14848")).toEqual([
      "https://arxiv.org/html/2611.14848",
      "https://arxiv.org/abs/2611.14848",
      "https://huggingface.co/papers/2611.14848",
    ]);
    expect(candidateUrls("https://example.com/a")).toEqual(["https://example.com/a"]);
  });

  it("strips scripts and tags into readable text", () => {
    const text = htmlToText("<html><script>evil()</script><nav>menu</nav><h1>Title</h1><p>Hello &amp; welcome</p></html>");
    expect(text).toBe("Title\nHello & welcome");
  });

  it("fetchSourceText skips failed candidates and short pages", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes("/html/")) return new Response("nope", { status: 404 });
      return new Response(`<html><body><p>${"Real abstract text. ".repeat(30)}</p></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    const r = await fetchSourceText("https://arxiv.org/abs/2611.14848", fake);
    expect(calls).toEqual(["https://arxiv.org/html/2611.14848", "https://arxiv.org/abs/2611.14848"]);
    expect(r?.text.startsWith("Real abstract text.")).toBe(true);
    expect(await fetchSourceText("http://localhost/x", fake)).toBeNull();
  });

  it("when the page itself is blocked it tries the public reader (r.jina.ai) last, never for private hosts", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://r.jina.ai/")) return new Response("Clean markdown body. ".repeat(20), { status: 200, headers: { "content-type": "text/plain" } });
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof fetch;
    const r = await fetchSourceText("https://blog.example.org/post", fake);
    expect(calls).toEqual(["https://blog.example.org/post", "https://r.jina.ai/https://blog.example.org/post"]);
    expect(r?.text.startsWith("Clean markdown body.")).toBe(true);
    calls.length = 0;
    expect(await fetchSourceText("http://10.0.0.5/secret", fake)).toBeNull();
    expect(calls).toEqual([]);
  });
});
