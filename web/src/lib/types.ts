export type Category = "llm_chat" | "dev" | "image_design" | "video_audio" | "research" | "industry" | "social";
export type Lifecycle = "hot" | "warm" | "archived";
export type CollectStatus = "active" | "paused" | "directory_only";
export type Difficulty = 1 | 2 | 3;

export interface Platform {
  id: string;
  name: string;
  category: Category;
  one_liner_ko: string;
  why_visit_ko: string;
  url: string;
  theme_color: string;
  access_note: string | null;
  collect_status: CollectStatus;
}

export interface Term {
  term: string;
  easy: string;
}

export interface Entity {
  name: string;
  kind: string;
  tags: string[];
}

/** items + summaries 를 화면용으로 합친 카드 1장 */
export interface FeedItem {
  id: string;
  platform_id: string;
  category: Category;
  canonical_url: string;
  thumbnail_url: string | null;
  importance_score: number;
  source_count: number;
  /** hot: 0~7일 메인 피드 / warm: 8~30일 지난 주요 소식 / archived: 31일+ */
  lifecycle_status: Lifecycle;
  published_at: string | null;
  /** 수집(유입) 시각 — 신선도 정렬과 'N시간 전' 표시의 기준 */
  created_at: string;
  hook_title: string;
  /** 10~16자 실전 이득 칩 (예: "상업용 무료 라이선스"). 없을 수 있음 */
  benefit_tag: string | null;
  context_ko: string | null;
  what_ko: string | null;
  analogy_ko: string | null;
  why_ko: string | null;
  caveats_ko: string | null;
  difficulty: Difficulty;
  terms: Term[];
  entities: Entity[];
  /** [원본 쉽게 읽기] 해설이 이미 준비돼 있는지 (샘플 데이터 또는 DB 캐시) */
  easy_original_ready: boolean;
}

/** [원본 쉽게 읽기] 완독 해설 — summaries.easy_original_json */
export interface EasyOriginalSection {
  /** 원문 흐름의 한 부분 (예: "초록", "핵심 원리", "실험 결과", "한계") */
  heading: string;
  /** 입문자가 100% 이해하도록 풀어 쓴 문단 */
  body: string;
  /** 해당 부분의 원문 핵심 문장·수치 (짧게, 원어 그대로). 없을 수 있음 */
  quote: string | null;
}

export interface EasyOriginal {
  sections: EasyOriginalSection[];
  /** 실제 원문 링크에 들어갈 때 관람 포인트 2~3줄 */
  watch_points: string[];
  /** 어떤 원문을 바탕으로 썼는지 (예: "Anthropic 공식 보도자료 전문") */
  source_note?: string | null;
  generated_at?: string | null;
  model?: string | null;
}

export type EasyOriginalResponse =
  | { status: "ready"; easy_original: EasyOriginal; cached: boolean; source: DataSource }
  | { status: "unavailable"; reason: "not_prepared" | "generator_unavailable" | "not_found" | "failed"; message: string };

export type DataSource = "supabase" | "sample";

/**
 * [원본 쉽게 읽기] 제공 방식
 * - sample     : 로컬 샘플 — 해설이 준비된 기사에서만 열 수 있음
 * - on_demand  : DB + 생성 키 연결 — 어떤 기사든 처음 누를 때 생성
 * - cache_only : DB 만 연결 — 이미 캐시된 해설만 열 수 있음
 */
export type EasyOriginalMode = "sample" | "on_demand" | "cache_only";

export interface RadarData {
  platforms: Platform[];
  items: FeedItem[];
  source: DataSource;
  /** 데이터를 만든 시각(ISO). 서버·클라이언트가 같은 기준 시각으로 정렬해 hydration 불일치를 막는다 */
  generatedAt: string;
  easyMode: EasyOriginalMode;
  /** 샘플 폴백 이유 등 화면 상단 안내 문구 */
  notice?: string;
}
