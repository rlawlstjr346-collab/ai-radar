import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FeatureStory, LeadStory, StreamRow } from "@/components/ItemCard";
import ItemDetail from "@/components/ItemDetail";
import { VisitDivider } from "@/components/RadarApp";
import samplePlatforms from "@/data/platforms.sample.json";
import { SAMPLE_FEED } from "@/data/sample-feed";
import { hotFeed, pastFeed } from "@/lib/filter";
import {
  computeBasePoints,
  computeGravityMetrics,
  computeGravityScore,
  GRAVITY_BUOYANCY_HOURS,
  GRAVITY_EXPONENT,
  GRAVITY_TIME_OFFSET_HOURS,
  isBuoyantHighGravity,
} from "@/lib/gravity";
import { loadLiveSnapshot } from "@/lib/live-snapshot";
import {
  areSameStory,
  clusterStories,
  extractStoryProfile,
  formatRelatedCaption,
  StoryClusterer,
} from "@/lib/story-clusterer";
import type { FeedItem, Platform } from "@/lib/types";
import {
  collectClusterItemIds,
  computeVisitDivider,
  formatVisitDividerLabel,
  initSessionLastVisit,
  LAST_VISIT_STORAGE_KEY,
  loadReadIds,
  MAX_READ_IDS,
  READ_IDS_STORAGE_KEY,
  recordReadIds,
  type StorageLike,
} from "@/lib/visit-state";

const PLATFORMS = samplePlatforms as Platform[];
const PLATFORMS_BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
const NAMES = new Map(PLATFORMS.map((p) => [p.id, p.name]));

function makeItem(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  const base = SAMPLE_FEED[0];
  const publishedAt = overrides.published_at !== undefined ? overrides.published_at : "2026-11-24T05:00:00Z";
  return {
    ...base,
    platform_id: "aitimes",
    category: "industry",
    canonical_url: `https://example.net/articles/${overrides.id}`,
    importance_score: 26,
    source_count: 1,
    source_platforms: [overrides.platform_id ?? "aitimes"],
    author_handle: null,
    lifecycle_status: "hot",
    published_at: publishedAt,
    fetched_at: publishedAt,
    created_at: overrides.created_at ?? publishedAt ?? "2026-11-24T05:00:00Z",
    original_title: overrides.original_title ?? overrides.hook_title ?? "Generic Title",
    title_ko: overrides.title_ko ?? overrides.hook_title ?? "테스트 기사 제목",
    hook_title: overrides.hook_title ?? "테스트 기사 제목",
    benefit_tag: overrides.benefit_tag !== undefined ? overrides.benefit_tag : null,
    context_ko: "AI 업계 소식 맥락입니다.",
    what_ko: "새로운 모델과 기능 업데이트 핵심 내용을 알기 쉽게 정리한 본문 설명입니다. 실무에서 바로 확인해 볼 수 있는 구체적 변경점이 담겨 있습니다.",
    analogy_ko: null,
    why_ko: "실무와 제품 기획 판단에 참고할 중요한 흐름이에요.",
    caveats_ko: "세부 수치는 원문 링크에서 확인하세요.",
    highlight_summary: "==핵심 변경점==을 빠르게 확인해 보세요.",
    difficulty: 2,
    terms: [],
    entities: [],
    easy_original_ready: true,
    ...overrides,
  };
}

function makeMemoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

describe("1. 다중 매체 동일 이슈 자동 클러스터링 (StoryClusterer)", () => {
  it("36시간 이내 동일 모델·버전 발표(Wenxin 5.5 Flash Preview)를 다중 매체에서 정확히 하나로 묶고 공신력 최고 기사를 대표로 세운다", () => {
    const verge = makeItem({
      id: "c-verge",
      platform_id: "the-verge-ai",
      canonical_url: "https://www.theverge.com/ai/wenxin-5-5-flash-preview",
      hook_title: "바이두, Wenxin 5.5 Flash Preview 오픈소스 모델 공식 공개",
      original_title: "Baidu open-sources Wenxin 5.5 Flash Preview model",
      published_at: "2026-11-24T05:10:00Z",
      importance_score: 30,
    });
    const kr36 = makeItem({
      id: "c-36kr",
      platform_id: "36kr-ai",
      canonical_url: "https://36kr.com/p/wenxin55",
      hook_title: "Wenxin 5.5 Flash Preview는 공식적으로 오픈 소스입니다",
      original_title: "文心5.5 Flash Preview正式开源",
      published_at: "2026-11-24T05:45:00Z",
      importance_score: 28,
    });
    const xPost = makeItem({
      id: "c-x",
      platform_id: "x",
      author_handle: "@Baidu_AI",
      canonical_url: "https://x.com/Baidu_AI/status/1990000001",
      hook_title: "@Baidu_AI: Wenxin 5.5 Flash Preview 가중치를 오픈소스로 공개합니다",
      original_title: "@Baidu_AI: Wenxin 5.5 Flash Preview weights are now open source",
      published_at: "2026-11-24T05:50:00Z",
      importance_score: 24,
      what_ko: "짧은 X 공지",
    });

    const clustered = new StoryClusterer().cluster([xPost, kr36, verge]);
    expect(clustered).toHaveLength(1);

    const rep = clustered[0];
    expect(rep.id).toBe("c-verge"); // 공신력·요약 품질 최고 대표 카드
    expect(rep.relatedArticles?.map((r) => r.id).sort()).toEqual(["c-36kr", "c-x"]);
    expect(rep.source_count).toBeGreaterThanOrEqual(3);
    expect(rep.source_platforms).toEqual(expect.arrayContaining(["the-verge-ai", "36kr-ai", "x"]));

    const captionKo = formatRelatedCaption(rep, PLATFORMS_BY_ID, "ko");
    const captionEn = formatRelatedCaption(rep, PLATFORMS_BY_ID, "en");
    expect(captionKo).toContain("외 관련 보도 2건");
    expect(captionKo).toContain("36Kr AI");
    expect(captionKo).toContain("𝕏");
    expect(captionEn).toContain("+2 more");
    expect(captionEn).toContain("𝕏");
  });

  it("고유 제품명(Shirudo) + OpenAI 공식 발표와 X 트윗을 묶고, 공식 블로그를 대표 카드로 선정한다", () => {
    const openaiBlog = makeItem({
      id: "shirudo-openai",
      platform_id: "openai",
      canonical_url: "https://openai.com/index/openai-and-cisco-introduce-shirudo",
      hook_title: "OpenAI와 Cisco가 Shirudo를 선보입니다",
      original_title: "OpenAI and Cisco introduce Shirudo",
      published_at: "2026-11-23T21:20:00Z",
      importance_score: 35,
    });
    const openaiX = makeItem({
      id: "shirudo-x",
      platform_id: "x",
      author_handle: "@OpenAI",
      canonical_url: "https://x.com/OpenAI/status/1999111222",
      hook_title: "에이전트가 가동 중단 없이 시스템을 방어할 수 있는 오픈 소스 Linux 런타임인 Shirudo를 소개합니다",
      original_title: "@OpenAI: We’re introducing Shirudo, an open-source Linux runtime allowing agents to defend systems without downtime.",
      published_at: "2026-11-23T21:37:00Z",
      importance_score: 44,
    });

    const clustered = clusterStories([openaiX, openaiBlog]);
    expect(clustered).toHaveLength(1);
    expect(clustered[0].id).toBe("shirudo-openai");
    expect(clustered[0].relatedArticles?.map((r) => r.id)).toEqual(["shirudo-x"]);
  });

  it("동일 GitHub 저장소(owner/repo)를 다루는 기사들을 하나로 묶는다", () => {
    const gh = makeItem({
      id: "repo-gh",
      platform_id: "github",
      canonical_url: "https://github.com/vllm-project/vllm/releases/tag/v0.34.1",
      hook_title: "vllm-project/vllm v0.34.1rc0 새 버전 공개",
      original_title: "vllm-project/vllm v0.34.1rc0 release",
      published_at: "2026-11-24T05:00:00Z",
    });
    const hn = makeItem({
      id: "repo-hn",
      platform_id: "hacker-news",
      canonical_url: "https://news.ycombinator.com/item?id=44550011",
      hook_title: "vllm-project/vllm 추론 속도 1.9배 개선 릴리즈 화제",
      original_title: "vllm-project/vllm 0.34 release improves inference speed",
      published_at: "2026-11-24T06:00:00Z",
    });

    expect(clusterStories([gh, hn])).toHaveLength(1);
  });

  it("오탐 차단: 단순 일반어(AI·모델·출시·오픈소스·에이전트)나 단일 회사명만 겹치는 서로 다른 기사는 절대 합치지 않는다", () => {
    const genericA = makeItem({
      id: "gen-a",
      platform_id: "v2ex",
      hook_title: "새로운 AI 에이전트 모델 오픈소스 개발 출시 후기",
      original_title: "New open source AI agent model release review",
      published_at: "2026-11-24T05:00:00Z",
    });
    const genericB = makeItem({
      id: "gen-b",
      platform_id: "juejin",
      hook_title: "최신 AI 에이전트 모델 오픈소스 개발 가이드 공개",
      original_title: "Latest open source AI agent model development guide",
      published_at: "2026-11-24T05:10:00Z",
    });

    const nvidiaStock = makeItem({
      id: "nv-stock",
      platform_id: "aitimes",
      hook_title: "젠슨 황 복귀에 엔비디아 주가 31% 급등…AI 관련주 동반 반등",
      original_title: "NVIDIA stock surges 31% on Jensen Huang return",
      published_at: "2026-11-24T05:22:00Z",
    });
    const nvidiaBci = makeItem({
      id: "nv-bci",
      platform_id: "36kr-ai",
      hook_title: "엔비디아, 미국 뇌-컴퓨터 인터페이스 회사와 협력해 고성능 AI 컴퓨팅 촉진",
      original_title: "NVIDIA partners with US brain-computer interface company for AI computing",
      published_at: "2026-11-24T05:17:00Z",
    });

    const gpt5 = makeItem({
      id: "gpt-5",
      platform_id: "openai",
      hook_title: "OpenAI, GPT-5 추론 모델 정식 출시",
      original_title: "OpenAI launches GPT-5 reasoning model",
      published_at: "2026-11-24T04:00:00Z",
    });
    const gpt62 = makeItem({
      id: "gpt-6-2",
      platform_id: "aitimes",
      hook_title: "오픈AI, 챗GPT에 GPT-6.2 솔 탑재",
      original_title: "OpenAI adds GPT-6.2 Sol to ChatGPT",
      published_at: "2026-11-24T04:30:00Z",
    });

    const dsCharts = makeItem({
      id: "ds-charts",
      platform_id: "simon-willison",
      hook_title: "datasette-charts 0.2a0 새 버전 공개",
      original_title: "datasette-charts 0.2a0",
      published_at: "2026-11-24T04:24:00Z",
    });
    const dsAgent = makeItem({
      id: "ds-agent",
      platform_id: "simon-willison",
      hook_title: "datasette-agent 0.7a1 새 버전 공개",
      original_title: "datasette-agent 0.7a1",
      published_at: "2026-11-24T03:45:00Z",
    });

    expect(areSameStory(extractStoryProfile(genericA), extractStoryProfile(genericB))).toBe(false);
    expect(areSameStory(extractStoryProfile(nvidiaStock), extractStoryProfile(nvidiaBci))).toBe(false);
    expect(areSameStory(extractStoryProfile(gpt5), extractStoryProfile(gpt62))).toBe(false);
    expect(areSameStory(extractStoryProfile(dsCharts), extractStoryProfile(dsAgent))).toBe(false);

    const all = [genericA, genericB, nvidiaStock, nvidiaBci, gpt5, gpt62, dsCharts, dsAgent];
    expect(clusterStories(all)).toHaveLength(all.length);
  });

  it("36시간 초과 간격의 기사는 같은 모델명이더라도 묶지 않는다", () => {
    const older = makeItem({
      id: "w-old",
      platform_id: "36kr-ai",
      hook_title: "Wenxin 5.5 Flash Preview 오픈소스 공개",
      original_title: "Wenxin 5.5 Flash Preview open sourced",
      published_at: "2026-11-22T00:00:00Z",
    });
    const newer = makeItem({
      id: "w-new",
      platform_id: "the-verge-ai",
      hook_title: "Wenxin 5.5 Flash Preview 벤치마크 검증 기사",
      original_title: "Wenxin 5.5 Flash Preview benchmark review",
      published_at: "2026-11-24T00:00:00Z", // 48시간 차이
    });

    expect(clusterStories([older, newer])).toHaveLength(2);
  });

  it("실제 web/public/live-feed.json 데이터에서 Shirudo 중복은 묶고 서로 다른 기사는 오병합하지 않는다", () => {
    const snap = loadLiveSnapshot();
    const clustered = clusterStories(snap.items);
    // 실제 스냅샷에 OpenAI Shirudo 블로그 + X @OpenAI Shirudo가 함께 있으면 1개로 합쳐짐
    const shirudoItems = clustered.filter((i) => /shirudo/i.test(`${i.hook_title} ${i.original_title ?? ""}`));
    expect(shirudoItems.length).toBeLessThanOrEqual(1);
    if (shirudoItems.length === 1) {
      expect(shirudoItems[0].platform_id).toBe("openai");
      expect(shirudoItems[0].relatedArticles?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
    // datasette-charts와 datasette-agent는 별개 유지
    const datasetteItems = clustered.filter((i) => /datasette-/i.test(`${i.hook_title} ${i.original_title ?? ""}`));
    if (snap.items.filter((i) => /datasette-/i.test(`${i.hook_title} ${i.original_title ?? ""}`)).length >= 2) {
      expect(datasetteItems.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("2. Hacker News 시간 중력 공식(Gravity) & 시차 방어 정렬", () => {
  it("중력 공식은 basePoints / (hoursSincePublished + 2)^1.8 을 정확히 따르고 출처 티어·클러스터 수·릴리즈 시그널을 반영한다", () => {
    expect(computeGravityScore(100, 0)).toBeCloseTo(100 / Math.pow(0 + GRAVITY_TIME_OFFSET_HOURS, GRAVITY_EXPONENT), 6);
    expect(computeGravityScore(100, 6)).toBeCloseTo(100 / Math.pow(6 + 2, 1.8), 6);

    const communityMinor = makeItem({
      id: "minor",
      platform_id: "v2ex",
      hook_title: "개인 사이드 프로젝트 소감 정리",
      original_title: "My personal side project notes",
      importance_score: 20,
      source_count: 1,
      source_platforms: ["v2ex"],
    });
    const frontierOfficial = makeItem({
      id: "frontier",
      platform_id: "openai",
      hook_title: "OpenAI, GPT-6.2 정식 출시 및 API 공개",
      original_title: "OpenAI launches GPT-6.2 model and API",
      importance_score: 32,
      source_count: 1,
      source_platforms: ["openai"],
    });
    const multiClusterBig = makeItem({
      id: "multi",
      platform_id: "the-verge-ai",
      hook_title: "DeepSeek V4 오픈 웨이트 공식 출시",
      original_title: "DeepSeek releases V4 open weights model",
      importance_score: 30,
      source_count: 4,
      source_platforms: ["the-verge-ai", "techcrunch-ai", "36kr-ai", "x"],
      relatedArticles: [
        makeItem({ id: "r1", platform_id: "techcrunch-ai" }),
        makeItem({ id: "r2", platform_id: "36kr-ai" }),
        makeItem({ id: "r3", platform_id: "x" }),
      ],
    });

    const pMinor = computeBasePoints(communityMinor);
    const pFrontier = computeBasePoints(frontierOfficial);
    const pMulti = computeBasePoints(multiClusterBig);
    expect(pFrontier).toBeGreaterThan(pMinor + 30);
    expect(pMulti).toBeGreaterThan(pFrontier);
  });

  it("1번 히어로 슬롯은 항상 가장 최근 미열람 속보를 유지하면서, 새벽(7시간 전) 고중력 빅테크 발표는 아침 단신보다 상단권에 체류한다", () => {
    const now = Date.parse("2026-11-24T09:00:00Z");
    const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

    const breakingNewest = makeItem({
      id: "live-breaking-5m",
      platform_id: "geeknews",
      hook_title: "방금 올라온 개발자 도구 단신",
      published_at: minsAgo(5),
      created_at: minsAgo(5),
      importance_score: 22,
    });
    const morningChatter = Array.from({ length: 6 }, (_, idx) =>
      makeItem({
        id: `live-chatter-${idx}`,
        platform_id: idx % 2 === 0 ? "v2ex" : "juejin",
        hook_title: `아침 커뮤니티 잡담 소식 ${idx}`,
        published_at: minsAgo(20 + idx * 15),
        created_at: minsAgo(20 + idx * 15),
        importance_score: 21,
      }),
    );
    const overnightBigLaunch = makeItem({
      id: "live-overnight-openai",
      platform_id: "openai",
      hook_title: "OpenAI, 차세대 GPT-6.2 오픈소스 SDK 및 모델 공식 출시",
      original_title: "OpenAI launches GPT-6.2 model and open source SDK",
      published_at: hoursAgo(7),
      created_at: hoursAgo(7),
      importance_score: 36,
      source_count: 3,
      source_platforms: ["openai", "the-verge-ai", "x"],
      relatedArticles: [
        makeItem({ id: "rel-v", platform_id: "the-verge-ai" }),
        makeItem({ id: "rel-x", platform_id: "x" }),
      ],
    });
    const stale15hBig = makeItem({
      id: "live-stale-15h",
      platform_id: "anthropic",
      hook_title: "Anthropic, Claude 5 프리뷰 발표",
      original_title: "Anthropic introduces Claude 5 preview",
      published_at: hoursAgo(GRAVITY_BUOYANCY_HOURS + 3), // 15시간 전 → 부력 해제
      created_at: hoursAgo(GRAVITY_BUOYANCY_HOURS + 3),
      importance_score: 36,
      source_count: 3,
      source_platforms: ["anthropic", "the-verge-ai", "techcrunch-ai"],
      relatedArticles: [
        makeItem({ id: "rel-a1", platform_id: "the-verge-ai" }),
        makeItem({ id: "rel-a2", platform_id: "techcrunch-ai" }),
      ],
    });

    const pool = [stale15hBig, overnightBigLaunch, ...morningChatter, breakingNewest];

    // 미열람 상태: 1번은 가장 최신 속보, 2번은 7시간 전 고중력 빅테크 발표, 15시간 지난 글은 부력 해제되어 하단
    const ranked = hotFeed(pool, "all", now, "", NAMES);
    expect(ranked[0].id).toBe("live-breaking-5m");
    expect(ranked[1].id).toBe("live-overnight-openai");
    expect(ranked[1].is_major_issue).toBe(true);
    expect(ranked[ranked.length - 1].id).toBe("live-stale-15h");

    // 이미 읽은 고중력 기사는 상단 부력이 해제되어 원래 시간순 자리로 내려간다
    const metricsOvernight = computeGravityMetrics(overnightBigLaunch, now);
    expect(isBuoyantHighGravity(overnightBigLaunch, metricsOvernight, new Set())).toBe(true);
    expect(isBuoyantHighGravity(overnightBigLaunch, metricsOvernight, new Set(["live-overnight-openai"]))).toBe(false);

    const rankedAfterRead = hotFeed(pool, "all", now, "", NAMES, {
      readIds: new Set(["live-overnight-openai"]),
    });
    expect(rankedAfterRead[0].id).toBe("live-breaking-5m");
    expect(rankedAfterRead.findIndex((i) => i.id === "live-overnight-openai")).toBeGreaterThan(4);
  });

  it("지난 주요 소식(pastFeed)도 중력 체급 정렬과 연동되어 다중 보도·프론티어 주요 이슈가 상위 노출된다", () => {
    const now = Date.parse("2026-11-24T09:00:00Z");
    const smallWarm = makeItem({
      id: "warm-small",
      platform_id: "v2ex",
      lifecycle_status: "warm",
      hook_title: "개인 블로그 단신",
      published_at: "2026-11-14T00:00:00Z",
      created_at: "2026-11-14T00:00:00Z",
      importance_score: 26,
    });
    const bigClusterWarm = makeItem({
      id: "warm-big-cluster",
      platform_id: "anthropic",
      lifecycle_status: "warm",
      hook_title: "Anthropic, 역대 최대 규모 IPO 발표 및 Claude 로드맵 공개",
      original_title: "Anthropic announces historic IPO and Claude roadmap",
      published_at: "2026-11-12T00:00:00Z",
      created_at: "2026-11-12T00:00:00Z",
      importance_score: 26,
      source_count: 3,
      source_platforms: ["anthropic", "the-verge-ai", "techcrunch-ai"],
      relatedArticles: [
        makeItem({ id: "w-rel1", platform_id: "the-verge-ai", lifecycle_status: "warm" }),
        makeItem({ id: "w-rel2", platform_id: "techcrunch-ai", lifecycle_status: "warm" }),
      ],
    });

    const past = pastFeed([smallWarm, bigClusterWarm], "all", "", NAMES, now);
    expect(past[0].id).toBe("warm-big-cluster");
    expect(past[0].is_major_issue).toBe(true);
  });
});

describe("3. 마지막 방문 이후 구분선 마커 & 4. 이미 읽음(✓ 읽음) 상태 및 UI 렌더링", () => {
  it("initSessionLastVisit 은 기존 방문 시각을 세션에 고정하고 저장소는 현재 시각으로 갱신한다", () => {
    const storage = makeMemoryStorage();
    const firstNow = Date.parse("2026-11-24T01:00:00Z");
    // 최초 방문: 직전 기록 없음 → null 반환, 저장소에는 firstNow 기록
    expect(initSessionLastVisit(firstNow, storage)).toBeNull();
    expect(storage.store[LAST_VISIT_STORAGE_KEY]).toBe(String(firstNow));

    // 재방문: 직전 방문 시각(firstNow) 반환해 세션 고정, 저장소는 secondNow 로 갱신
    const secondNow = Date.parse("2026-11-24T05:00:00Z");
    expect(initSessionLastVisit(secondNow, storage)).toBe(firstNow);
    expect(storage.store[LAST_VISIT_STORAGE_KEY]).toBe(String(secondNow));
  });

  it("computeVisitDivider 는 직전 방문 이후 새 소식 수·주요 이슈 수와 경계 인덱스를 정확히 계산한다", () => {
    const now = Date.parse("2026-11-24T06:00:00Z");
    const lastVisitTs = Date.parse("2026-11-24T03:00:00Z");

    const newRegular = makeItem({
      id: "new-1",
      published_at: "2026-11-24T05:30:00Z",
      is_major_issue: false,
    });
    const newMajor = makeItem({
      id: "new-2",
      platform_id: "openai",
      published_at: "2026-11-24T04:00:00Z",
      is_major_issue: true,
    });
    const oldItem = makeItem({
      id: "old-1",
      published_at: "2026-11-24T01:00:00Z",
      is_major_issue: false,
    });

    const divider = computeVisitDivider([newRegular, newMajor, oldItem], lastVisitTs, now);
    expect(divider).toEqual({ afterIndex: 1, newCount: 2, majorCount: 1 });
    expect(formatVisitDividerLabel(divider!, "ko")).toBe(
      "여기까지 확인하셨습니다 · 마지막 방문 이후 새 소식 2건 · 주요 이슈 1건",
    );
    expect(formatVisitDividerLabel(divider!, "en")).toBe(
      "Caught up here · 2 new since last visit · 1 major",
    );

    // 새 소식만 있고 아래에 이전 기사가 없으면 구분선 미표시
    expect(computeVisitDivider([newRegular, newMajor], lastVisitTs, now)).toBeNull();
    // 새 소식이 0건이어도 구분선 미표시
    expect(computeVisitDivider([oldItem], lastVisitTs, now)).toBeNull();
  });

  it("readIds 는 클러스터 관련 기사 ID까지 함께 저장하고 최대 1,000개 상한을 유지한다", () => {
    const storage = makeMemoryStorage();
    const clusterItem = makeItem({
      id: "rep-1",
      relatedArticles: [makeItem({ id: "sub-1" }), makeItem({ id: "sub-2" })],
    });
    expect(collectClusterItemIds(clusterItem)).toEqual(["rep-1", "sub-1", "sub-2"]);

    let ids = recordReadIds([], collectClusterItemIds(clusterItem), storage);
    expect(loadReadIds(storage)).toEqual(["rep-1", "sub-1", "sub-2"]);

    // 1,050개 누적 시 최근 1,000개만 유지
    const bulk = Array.from({ length: 1050 }, (_, i) => `id-${i}`);
    ids = recordReadIds(ids, bulk, storage);
    expect(ids).toHaveLength(MAX_READ_IDS);
    expect(ids[0]).toBe("id-50");
    expect(ids[ids.length - 1]).toBe("id-1049");
    expect(JSON.parse(storage.store[READ_IDS_STORAGE_KEY])).toHaveLength(MAX_READ_IDS);
  });

  it("중요 기사 무채색 강조(newsroom-card-major + 주요 이슈 배지), 읽음 상태(✓ 읽음 + 강조 해제), 관련 보도 캡션·모달·구분선이 올바르게 렌더링된다", () => {
    const now = Date.parse("2026-11-24T06:00:00Z");
    const related = [
      makeItem({
        id: "rel-36kr",
        platform_id: "36kr-ai",
        canonical_url: "https://36kr.com/p/333333",
        hook_title: "36Kr 보도: Wenxin 5.5 오픈소스 공개",
        published_at: "2026-11-24T05:10:00Z",
      }),
      makeItem({
        id: "rel-x",
        platform_id: "x",
        author_handle: "@Baidu_AI",
        canonical_url: "https://x.com/Baidu_AI/status/999999",
        hook_title: "@Baidu_AI: Wenxin 5.5 Flash Preview 공개",
        published_at: "2026-11-24T05:15:00Z",
      }),
    ];
    const majorItem = makeItem({
      id: "major-rep",
      platform_id: "the-verge-ai",
      hook_title: "바이두, Wenxin 5.5 Flash Preview 공식 오픈소스 공개",
      original_title: "Baidu open-sources Wenxin 5.5 Flash Preview",
      published_at: "2026-11-24T05:00:00Z",
      source_count: 3,
      source_platforms: ["the-verge-ai", "36kr-ai", "x"],
      relatedArticles: related,
      is_major_issue: true,
    });

    const commonProps = {
      item: majorItem,
      platform: PLATFORMS_BY_ID.get("the-verge-ai"),
      platformsById: PLATFORMS_BY_ID,
      selected: false,
      now,
      lang: "ko" as const,
      onSelect: () => {},
      onSelectPlatform: () => {},
      onEntity: () => {},
    };

    // 1) 미열람 주요 이슈 카드: newsroom-card-major + 주요 이슈 배지 + 관련 보도 캡션
    const unreadHtml = renderToStaticMarkup(
      React.createElement(LeadStory, { ...commonProps, isRead: false, isMajor: true }),
    );
    expect(unreadHtml).toContain("newsroom-card-major");
    expect(unreadHtml).toContain('data-major="true"');
    expect(unreadHtml).toContain('data-read="false"');
    expect(unreadHtml).toContain("주요 이슈");
    expect(unreadHtml).toContain("외 관련 보도 2건");
    expect(unreadHtml).toContain("36Kr AI");
    expect(unreadHtml).toContain("𝕏");
    expect(unreadHtml).not.toContain('data-read-badge="true"');

    // 2) 이미 읽은 주요 이슈 카드: newsroom-card-major 해제 + data-read="true" + ✓ 읽음 표기
    const readHtml = renderToStaticMarkup(
      React.createElement(StreamRow, { ...commonProps, isRead: true, isMajor: true }),
    );
    expect(readHtml).not.toContain("newsroom-card-major");
    expect(readHtml).toContain('data-read="true"');
    expect(readHtml).toContain('data-major="false"');
    expect(readHtml).toContain('data-read-badge="true"');
    expect(readHtml).toContain("읽음");

    // 3) 영문 모드 피처 카드: Major / +2 more
    const enHtml = renderToStaticMarkup(
      React.createElement(FeatureStory, { ...commonProps, lang: "en", isRead: false, isMajor: true }),
    );
    expect(enHtml).toContain("Major");
    expect(enHtml).toContain("+2 more");

    // 4) 모달 내 '관련 보도 함께 보기 (2건)' 섹션 & 외부 링크
    const detailHtml = renderToStaticMarkup(
      React.createElement(ItemDetail, {
        item: majorItem,
        platform: PLATFORMS_BY_ID.get("the-verge-ai"),
        platformsById: PLATFORMS_BY_ID,
        lang: "ko",
        onSelectPlatform: () => {},
      }),
    );
    expect(detailHtml).toContain('data-related-section="true"');
    expect(detailHtml).toContain("관련 보도 함께 보기 (2건)");
    expect(detailHtml).toContain("https://36kr.com/p/333333");
    expect(detailHtml).toContain("https://x.com/Baidu_AI/status/999999");

    // 5) 마지막 방문 이후 얇은 구분선 마커 (col-span-full)
    const dividerHtml = renderToStaticMarkup(
      React.createElement(VisitDivider, { info: { afterIndex: 1, newCount: 3, majorCount: 1 }, lang: "ko" }),
    );
    expect(dividerHtml).toContain('role="separator"');
    expect(dividerHtml).toContain("col-span-full");
    expect(dividerHtml).toContain("여기까지 확인하셨습니다 · 마지막 방문 이후 새 소식 3건 · 주요 이슈 1건");
  });
});
