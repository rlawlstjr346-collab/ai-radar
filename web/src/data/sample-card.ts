import type { Category, Difficulty, Entity, FeedItem, Term } from "@/lib/types";

/** 샘플 카드 한 장 입력 (sample-feed.ts · sample-feed-global.ts 공용) */
export type CardInput = {
  id: string;
  platform: string;
  category: Category;
  url: string;
  score: number;
  at: string;
  sources?: number;
  /** 여러 곳에서 포착된 경우 그 플랫폼들 (수집 당시 실제로 함께 잡힌 소스) */
  sourcePlatforms?: string[];
  /** 원문 난이도(해독 배지): 1 가벼운 트렌드 / 2 개발 실무 문서 / 3 박사급 논문 */
  difficulty: Difficulty;
  hook: string;
  /** 10~16자 실전 이득 칩. 원문이 받쳐 주는 이득이 없으면 생략 */
  benefit?: string;
  context: string;
  what: string;
  analogy?: string | null;
  why: string;
  caveats?: string | null;
  terms?: Term[];
  entities?: Entity[];
};

export function card(c: CardInput): FeedItem {
  return {
    id: `sample-${c.id}`,
    platform_id: c.platform,
    category: c.category,
    canonical_url: c.url,
    thumbnail_url: null,
    importance_score: c.score,
    source_count: c.sources ?? 1,
    source_platforms: c.sourcePlatforms ?? [c.platform],
    lifecycle_status: "hot", // buildSampleFeed 가 수집 경과시간으로 다시 계산
    published_at: c.at,
    created_at: c.at, // buildSampleFeed 가 '지금 - 수집 경과시간'으로 덮어씀
    hook_title: c.hook,
    benefit_tag: c.benefit ?? null,
    context_ko: c.context,
    what_ko: c.what,
    analogy_ko: c.analogy ?? null,
    why_ko: c.why,
    caveats_ko: c.caveats ?? null,
    difficulty: c.difficulty,
    terms: c.terms ?? [],
    entities: c.entities ?? [],
    easy_original_ready: false, // buildSampleFeed 가 채움
  };
}

export const e = (name: string, kind: string, ...tags: string[]): Entity => ({ name, kind, tags });
