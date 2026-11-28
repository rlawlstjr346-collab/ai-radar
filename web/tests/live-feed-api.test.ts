import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getLiveFeedRoute, dynamic as liveFeedDynamic } from "@/app/api/live-feed/route";
import samplePlatforms from "@/data/platforms.sample.json";
import { SAMPLE_FEED } from "@/data/sample-feed";
import { getEasyOriginal } from "@/lib/easy-original";
import {
  clearClientEasyCache,
  fetchLatestLiveFeed,
  getClientEasyOriginal,
  mergeLiveFeedItems,
} from "@/lib/live-client";
import {
  buildLiveFeedPayload,
  clearLiveHarvesterCaches,
  containsUntranslatedCjk,
  LIVE_HARVEST_SOURCES,
  normalizeTitleForDedup,
  normalizeUrlForDedup,
  parseRssOrAtomXml,
} from "@/lib/live-harvester";
import type { LiveSnapshot } from "@/lib/live-snapshot";
import type { FeedItem, Platform } from "@/lib/types";

const VALID_PLATFORM_IDS = new Set((samplePlatforms as Platform[]).map((p) => p.id));

function makeStaleSnapshot(baseNow: Date): LiveSnapshot {
  const stale5h = new Date(baseNow.getTime() - 5 * 3_600_000).toISOString();
  const stale8h = new Date(baseNow.getTime() - 8 * 3_600_000).toISOString();
  const warm10d = new Date(baseNow.getTime() - 10 * 86_400_000).toISOString();
  const items: FeedItem[] = [
    {
      ...SAMPLE_FEED[0],
      id: "live-old-openai",
      platform_id: "openai",
      category: "industry",
      canonical_url: "https://openai.com/index/already-in-snapshot",
      original_title: "Already in snapshot OpenAI release",
      title_ko: "스냅샷에 이미 담긴 OpenAI 발표",
      hook_title: "스냅샷에 이미 담긴 OpenAI 발표",
      published_at: stale5h,
      fetched_at: stale5h,
      created_at: stale5h,
      lifecycle_status: "hot",
      importance_score: 45,
      easy_original_ready: true,
    },
    {
      ...SAMPLE_FEED[1],
      id: "live-old-verge",
      platform_id: "the-verge-ai",
      category: "industry",
      canonical_url: "https://www.theverge.com/ai/2026/11/24/older-story",
      original_title: "Older AI story from five hours ago",
      title_ko: "5시간 전 오래된 AI 소식",
      hook_title: "5시간 전 오래된 AI 소식",
      published_at: stale8h,
      fetched_at: stale5h,
      created_at: stale8h,
      lifecycle_status: "hot",
      importance_score: 42,
      easy_original_ready: true,
    },
    {
      ...SAMPLE_FEED[2],
      id: "live-warm-archive",
      platform_id: "anthropic",
      category: "research",
      canonical_url: "https://www.anthropic.com/news/warm-archive-post",
      original_title: "Warm archive article",
      title_ko: "지난 주요 소식 아카이브 기사",
      hook_title: "지난 주요 소식 아카이브 기사",
      published_at: warm10d,
      fetched_at: stale5h,
      created_at: warm10d,
      lifecycle_status: "warm",
      importance_score: 40,
      easy_original_ready: true,
    },
  ];
  return {
    generatedAt: stale5h,
    items,
    easyOriginals: {},
  };
}

describe("실시간 라이브 보강 수집 & 즉시 병합 API (/api/live-feed)", () => {
  beforeEach(() => {
    clearLiveHarvesterCaches();
    clearClientEasyCache();
  });

  it("GitHub 스냅샷이 5시간 전 상태여도 최신 글로벌·국내·중국·X 실시간 한국어 기사가 최상단에 병합된다", async () => {
    const now = new Date("2026-11-24T06:30:00Z");
    const staleSnap = makeStaleSnapshot(now);
    const min3Ago = new Date(now.getTime() - 3 * 60_000).toUTCString();
    const min7AgoIso = new Date(now.getTime() - 7 * 60_000).toISOString();
    const min12AgoSec = Math.floor((now.getTime() - 12 * 60_000) / 1000);
    const min18AgoMs = now.getTime() - 18 * 60_000;
    const min22Ago = new Date(now.getTime() - 22 * 60_000).toUTCString();
    const min25AgoIso = new Date(now.getTime() - 25 * 60_000).toISOString();

    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://openai.com/news/rss.xml")) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0"><channel>
            <item>
              <title>OpenAI launches realtime voice agents API</title>
              <link>https://openai.com/index/realtime-voice-agents-api</link>
              <pubDate>${min3Ago}</pubDate>
              <description>OpenAI released low-latency voice agents API with tool calling for developers.</description>
            </item>
            <item>
              <title>Already in snapshot OpenAI release</title>
              <link>https://openai.com/index/already-in-snapshot?utm_source=rss</link>
              <pubDate>${min22Ago}</pubDate>
              <description>Duplicate article with utm query param.</description>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }

      if (url.startsWith("https://www.aitimes.com/rss/allArticle.xml")) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0"><channel>
            <item>
              <title>국내 연구진, 온디바이스 한국어 AI 에이전트 경량 모델 공개</title>
              <link>https://www.aitimes.com/news/articleView.html?idxno=999901</link>
              <pubDate>${min22Ago}</pubDate>
              <description>국내 연구팀이 스마트폰에서도 실시간으로 동작하는 한국어 AI 에이전트 경량 모델을 오픈소스로 공개했다.</description>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }

      if (url.includes("v2ex.com/api/topics/show.json?node_name=create")) {
        return new Response(
          JSON.stringify([
            {
              id: 1122334,
              title: "开源了一个本地运行 MCP Agent 工作流工具",
              content: "独立开发了一个基于 LLM 的开源 MCP 工作流客户端，支持 GitHub 仓库一键部署 https://github.com/demo/mcp-flow",
              url: "https://www.v2ex.com/t/1122334",
              created: min12AgoSec,
              replies: 24,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("gateway.36kr.com")) {
        return new Response(
          JSON.stringify({
            data: {
              itemList: [
                {
                  itemId: "30999888",
                  templateMaterial: {
                    widgetTitle: "智谱发布新一代开源代码大模型 GLM-Code",
                    summary: "新模型在长上下文代码推理基准上提升显著并采用开源协议。",
                    publishTime: min18AgoMs,
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("hn.algolia.com") && url.includes("tags=show_hn")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                objectID: "44556677",
                title: "Show HN: Open-source AI code reviewer with MCP support",
                url: "https://github.com/builder/ai-code-reviewer",
                points: 85,
                created_at: min7AgoIso,
                story_text: "Built a fast open-source AI pull request reviewer powered by MCP tools.",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("hn.algolia.com") && url.includes("x.com")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                objectID: "88990011",
                title: "Anthropic shares new Claude agent eval benchmark",
                url: "https://x.com/AnthropicAI/status/1999999999999999999",
                created_at: min25AgoIso,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.startsWith("https://publish.twitter.com/oembed")) {
        return new Response(
          JSON.stringify({
            html: "<blockquote><p>We just shipped a new open-source Claude agent benchmark toolkit for coding workflows.</p></blockquote>",
            author_name: "Anthropic",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.startsWith("https://translate.googleapis.com/translate_a/single")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        const map: Record<string, string> = {
          "OpenAI launches realtime voice agents API": "OpenAI, 실시간 음성 에이전트 API 출시",
          "OpenAI released low-latency voice agents API with tool calling for developers.":
            "OpenAI가 개발자를 위해 도구 호출을 지원하는 저지연 음성 에이전트 API를 공개했습니다.",
          "Show HN: Open-source AI code reviewer with MCP support": "Show HN: MCP 지원 오픈소스 AI 코드 리뷰어 공개",
          "Built a fast open-source AI pull request reviewer powered by MCP tools.":
            "MCP 도구 기반으로 빠르게 동작하는 오픈소스 AI PR 리뷰어를 개발했습니다.",
          "开源了一个本地运行 MCP Agent 工作流工具": "로컬 실행 MCP 에이전트 워크플로 도구 오픈소스 공개",
          "独立开发了一个基于 LLM 的开源 MCP 工作流客户端，支持 GitHub 仓库一键部署":
            "LLM 기반 오픈소스 MCP 워크플로 클라이언트를 1인 개발해 GitHub 원클릭 배포를 지원합니다.",
          "智谱发布新一代开源代码大模型 GLM-Code": "즈푸AI, 차세대 오픈소스 코딩 모델 GLM-Code 발표",
          "新模型在长上下文代码推理基准上提升显著并采用开源协议。":
            "새 모델은 긴 문맥 코드 추론 벤치마크에서 성능을 높였고 오픈소스 라이선스로 공개됐습니다.",
          "@AnthropicAI: We just shipped a new open-source Claude agent benchmark toolkit for coding workflows.":
            "@AnthropicAI: 코딩 워크플로용 오픈소스 Claude 에이전트 벤치마크 툴킷을 공개했습니다.",
          "We just shipped a new open-source Claude agent benchmark toolkit for coding workflows.":
            "코딩 워크플로용 오픈소스 Claude 에이전트 벤치마크 툴킷을 새로 출시했습니다.",
        };
        const translated = map[q] ?? `실시간 AI 번역 요약: ${q.replace(/[\u4e00-\u9fff\u3040-\u30ff]+/g, "")}`;
        return new Response(JSON.stringify([[[translated, q]]]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // 나머지 소스는 장애·타임아웃 시뮬레이션 (개별 격리 확인)
      return new Response("upstream timeout", { status: 503 });
    });

    const payload = await buildLiveFeedPayload({
      now,
      fetchImpl: mockFetch,
      loadSnapshot: async () => staleSnap,
      sourceTimeoutMs: 2500,
      translateTimeoutMs: 2500,
      bypassCache: true,
    });

    expect(payload.version).toBe(1);
    expect(payload.snapshot_generated_at).toBe(staleSnap.generatedAt);
    expect(payload.live_added_count).toBe(6); // OpenAI(중복1 제외), Show HN, V2EX, 36Kr, AI타임스, X
    expect(payload.generated_at).toBe(now.toISOString());

    const hotItems = payload.items.filter((i) => i.lifecycle_status === "hot");
    // 1. 순수 최신 시각(published_at 내림차순) 최우선 정렬 확인
    expect(hotItems[0].canonical_url).toBe("https://openai.com/index/realtime-voice-agents-api");
    expect(hotItems[0].hook_title).toBe("OpenAI, 실시간 음성 에이전트 API 출시");
    expect(hotItems[1].canonical_url).toBe("https://github.com/builder/ai-code-reviewer");
    expect(hotItems[2].canonical_url).toBe("https://www.v2ex.com/t/1122334");
    expect(hotItems[3].canonical_url).toBe("https://36kr.com/p/30999888");
    expect(hotItems[4].canonical_url).toBe("https://www.aitimes.com/news/articleView.html?idxno=999901");
    expect(hotItems[5].canonical_url).toBe("https://x.com/AnthropicAI/status/1999999999999999999");

    // 5시간 전 스냅샷 기사는 신규 실시간 기사들 바로 뒤에 위치
    expect(hotItems[6].id).toBe("live-old-openai");

    // 2. 중복 제거 검증 (utm_source 붙은 OpenAI 중복 글 1건만 존재)
    const dupCount = payload.items.filter((i) =>
      normalizeUrlForDedup(i.canonical_url).includes("openai.com/index/already-in-snapshot"),
    ).length;
    expect(dupCount).toBe(1);

    // 3. 지난 주요 소식(warm) 보존 확인
    expect(payload.items.some((i) => i.id === "live-warm-archive" && i.lifecycle_status === "warm")).toBe(true);

    // 4. 새로 병합된 모든 실시간 기사의 한국어 제목·4단 요약·원본 쉽게 읽기 계약 전수 검증
    const newlyAdded = hotItems.slice(0, 6);
    for (const item of newlyAdded) {
      expect(VALID_PLATFORM_IDS.has(item.platform_id), item.id).toBe(true);
      expect(item.id.startsWith("live-edge-")).toBe(true);
      expect(item.hook_title).toMatch(/[가-힣]/);
      expect(containsUntranslatedCjk(item.hook_title)).toBe(false);
      expect(item.context_ko?.trim().length).toBeGreaterThan(10);
      expect(item.what_ko?.trim().length).toBeGreaterThan(15);
      expect(item.why_ko?.trim().length).toBeGreaterThan(15);
      expect(item.highlight_summary).toContain("==");
      expect(item.utility_tip?.when_needed.length).toBeGreaterThan(10);
      expect(item.planning_meta?.signal_type).toBeTruthy();
      expect(item.easy_original_ready).toBe(true);
      expect(item.easy_original?.sections.length).toBeGreaterThanOrEqual(3);
      expect(item.easy_original?.watch_points.length).toBeGreaterThanOrEqual(2);

      // /api/items/[id]/easy-original 서버 조회도 즉시 ready 반환
      const easyRes = await getEasyOriginal(item.id);
      expect(easyRes.httpStatus).toBe(200);
      expect(easyRes.body.status).toBe("ready");
    }
  });

  it("정규화 제목이 동일하거나 번역 엔드포인트가 모두 실패해도 중복 0건·한국어 제목 폴백을 보장한다", async () => {
    const now = new Date("2026-11-24T06:30:00Z");
    const staleSnap = makeStaleSnapshot(now);
    const min4Ago = new Date(now.getTime() - 4 * 60_000).toUTCString();

    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://techcrunch.com/")) {
        return new Response(
          `<rss version="2.0"><channel>
            <item>
              <title>Already in snapshot OpenAI release!!!</title>
              <link>https://techcrunch.com/2026/11/24/duplicate-title-article/</link>
              <pubDate>${min4Ago}</pubDate>
              <description>Same title syndicated elsewhere.</description>
            </item>
            <item>
              <title>DeepSeek announces fast reasoning model</title>
              <link>https://techcrunch.com/2026/11/24/deepseek-fast-reasoning/</link>
              <pubDate>${min4Ago}</pubDate>
              <description>DeepSeek released a new open weights reasoning model.</description>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }
      // 번역 엔드포인트 포함 모든 나머지 요청 실패 시뮬레이션
      return new Response("blocked", { status: 429 });
    });

    const payload = await buildLiveFeedPayload({
      now,
      fetchImpl: mockFetch,
      loadSnapshot: async () => staleSnap,
      bypassCache: true,
    });

    // 정규화 제목이 스냅샷과 같은 글은 스킵, 신규 1건만 추가
    expect(payload.live_added_count).toBe(1);
    const top = payload.items[0];
    expect(top.canonical_url).toBe("https://techcrunch.com/2026/11/24/deepseek-fast-reasoning/");
    // 번역기 장애 시에도 한국어 제목·요약 보장 + EN 토글용 original_title 보존
    expect(top.hook_title).toMatch(/[가-힣]/);
    expect(top.original_title).toBe("DeepSeek announces fast reasoning model");
  });

  it("GET /api/live-feed 라우트는 정적(force-static) 생성 + CDN 캐시 헤더(s-maxage=180, stale-while-revalidate=300)와 유효한 JSON을 반환한다", async () => {
    expect(liveFeedDynamic).toBe("force-static");
    // 외부 네트워크 없이 로컬 폴백으로 즉시 응답 검증
    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("offline", { status: 503 })) as typeof fetch;
    try {
      const res = await getLiveFeedRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, s-maxage=180, stale-while-revalidate=300");
      const body = (await res.json()) as { version: number; item_count: number; items: FeedItem[] };
      expect(body.version).toBe(1);
      expect(body.item_count).toBeGreaterThan(20);
      expect(body.items.length).toBe(body.item_count);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("주요 속보 창구 목록·RSS/Atom 파서·URL/제목 정규화 유틸이 정확하게 동작한다", () => {
    const pids = new Set(LIVE_HARVEST_SOURCES.map((s) => s.platformId));
    for (const required of [
      "openai",
      "the-verge-ai",
      "techcrunch-ai",
      "simon-willison",
      "hacker-news",
      "geeknews",
      "aitimes",
      "v2ex",
      "juejin",
      "qbitai",
      "36kr-ai",
      "latent-space",
      "import-ai",
      "ahead-of-ai",
      "x",
    ]) {
      expect(pids.has(required), required).toBe(true);
    }

    expect(normalizeUrlForDedup("https://www.OpenAI.com/index/post/?utm_source=x&ref=hn#top")).toBe(
      "https://openai.com/index/post",
    );
    expect(normalizeTitleForDedup("@OpenAI: Hello, World!! ")).toBe("helloworld");

    const parsedAtom = parseRssOrAtomXml(
      `<feed><entry><title><![CDATA[Claude Code 2.0]]></title><link rel="alternate" href="https://simonwillison.net/2026/nov/24/claude/"/><updated>2026-11-24T06:10:00Z</updated><summary>New agent features.</summary></entry></feed>`,
    );
    expect(parsedAtom).toHaveLength(1);
    expect(parsedAtom[0].title).toBe("Claude Code 2.0");
    expect(parsedAtom[0].link).toBe("https://simonwillison.net/2026/nov/24/claude/");
  });

  it("클라이언트 fetchLatestLiveFeed 는 엣지 /api/live-feed 를 최우선 호출하고 모달 열린 기사 보존·무변경 참조 유지를 보장한다", async () => {
    const freshItem: FeedItem & { easy_original: { sections: Array<{ heading: string; body: string; quote: null }>; watch_points: string[] } } = {
      ...SAMPLE_FEED[0],
      id: "live-edge-abc123456789",
      platform_id: "openai",
      canonical_url: "https://openai.com/index/fresh-client-test",
      published_at: "2026-11-24T06:28:00Z",
      created_at: "2026-11-24T06:28:00Z",
      hook_title: "실시간 API에서 수신된 최신 기사",
      easy_original_ready: true,
      easy_original: {
        sections: [{ heading: "배경", body: "상세 해설 본문입니다.", quote: null }],
        watch_points: ["원문 수치 확인"],
      },
    };

    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calledUrls.push(url);
      if (url === "/api/live-feed") {
        return new Response(
          JSON.stringify({
            version: 1,
            generated_at: "2026-11-24T06:30:00Z",
            live_added_count: 1,
            items: [freshItem],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const snap = await fetchLatestLiveFeed(VALID_PLATFORM_IDS, undefined, mockFetch);
    expect(calledUrls).toEqual(["/api/live-feed"]);
    expect(snap?.source).toBe("api");
    expect(snap?.items[0].id).toBe("live-edge-abc123456789");
    expect(getClientEasyOriginal("live-edge-abc123456789")?.sections[0].heading).toBe("배경");

    // 열려 있는 모달 기사 보존 + 변경 없을 때 기존 배열 참조 유지
    const openedOldLive: FeedItem = {
      ...SAMPLE_FEED[1],
      id: "live-opened-modal-item",
      canonical_url: "https://openai.com/index/opened-in-modal",
    };
    const merged = mergeLiveFeedItems([openedOldLive, SAMPLE_FEED[2]], snap!.items, "live-opened-modal-item");
    expect(merged.some((i) => i.id === "live-opened-modal-item")).toBe(true);
    expect(merged[0].id).toBe("live-edge-abc123456789");

    const sameAgain = mergeLiveFeedItems(merged, snap!.items, "live-opened-modal-item");
    expect(sameAgain).toBe(merged);
  });

  it("vercel.json 에 일 1회 초과 crons 설정이 없고, collect.yml 이 15분 주기 스케줄과 timeout 12분을 유지한다", () => {
    const vercelJson = JSON.parse(readFileSync(join(__dirname, "../vercel.json"), "utf8")) as Record<string, unknown>;
    expect(vercelJson.crons).toBeUndefined();

    const collectYml = readFileSync(join(__dirname, "../../.github/workflows/collect.yml"), "utf8");
    expect(collectYml).toContain('cron: "*/15 * * * *"');
    expect(collectYml).toContain("timeout-minutes: 12");
    expect(collectYml).toContain("cancel-in-progress: true");
    expect(collectYml).toContain("web/public/data/planning-feed.json");
  });
});
