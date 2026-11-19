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
  context_ko: string | null;
  what_ko: string | null;
  analogy_ko: string | null;
  why_ko: string | null;
  caveats_ko: string | null;
  difficulty: Difficulty;
  terms: Term[];
  entities: Entity[];
}

export type DataSource = "supabase" | "sample";

export interface RadarData {
  platforms: Platform[];
  items: FeedItem[];
  source: DataSource;
  /** 데이터를 만든 시각(ISO). 서버·클라이언트가 같은 기준 시각으로 정렬해 hydration 불일치를 막는다 */
  generatedAt: string;
  /** 샘플 폴백 이유 등 화면 상단 안내 문구 */
  notice?: string;
}
