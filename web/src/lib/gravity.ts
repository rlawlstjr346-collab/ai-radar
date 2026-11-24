import type { FeedItem } from "./types";

/** HN 중력 공식 지수: basePoints / (hoursSincePublished + 2)^1.8 */
export const GRAVITY_EXPONENT = 1.8;
export const GRAVITY_TIME_OFFSET_HOURS = 2;

/** 최근 12시간 이내 고중력 주요 이슈만 상단 부력 유지 (오래된 글 고착 방지) */
export const GRAVITY_BUOYANCY_HOURS = 12;

/** 프론티어 공식 발표 출처 (1티어 가산점) */
export const FRONTIER_OFFICIAL_PLATFORMS = new Set([
  "openai",
  "anthropic",
  "google-deepmind",
  "meta-ai",
  "deepseek",
  "qwen",
  "mistral",
  "nvidia",
  "xai",
  "apple-ml",
  "microsoft-research",
  "aws-ml",
  "huggingface",
]);

const OFFICIAL_FRONTIER_X_HANDLES = new Set([
  "@openai",
  "@anthropicai",
  "@googledeepmind",
  "@deepseek_ai",
  "@alibaba_qwen",
  "@mistralai",
  "@xai",
  "@nvidia",
  "@aiatmeta",
  "@huggingface",
]);

/** 2티어 주요 글로벌·국내·중국 AI 전문 미디어 및 심층 뉴스레터 */
const MAJOR_MEDIA_PLATFORMS = new Set([
  "the-verge-ai",
  "techcrunch-ai",
  "ars-technica",
  "wired",
  "mit-tr",
  "mit-tr-korea",
  "aitimes",
  "36kr-ai",
  "qbitai",
  "simon-willison",
  "latent-space",
  "import-ai",
  "ahead-of-ai",
  "interconnects",
  "one-useful-thing",
  "itmedia-aiplus",
  "toss-tech",
]);

/** 3티어 개발자·커뮤니티 큐레이션 */
const CURATED_DEV_PLATFORMS = new Set([
  "github",
  "hacker-news",
  "geeknews",
  "gpters",
  "pytorch-kr",
  "qiita",
  "hatena-bookmark",
]);

const FRONTIER_SUBJECT_RE =
  /(OpenAI|Anthropic|Google\s*DeepMind|DeepMind|DeepSeek|Qwen|GPT[-\s]?[456]|o[34][-\s]?(?:mini|pro)?|Claude\s*(?:[345]|Code|Opus|Sonnet|Ship)|Gemini\s*[234]|Llama\s*[34]|GLM[-\s]?[45]|Wenxin|文心|文心5|Kimi|Mistral|Grok|Sora|Veo|vLLM|NVIDIA|엔비디아|오픈AI|앤트로픽|딥시크|제미나이|클로드|큐원|문심)/i;

const MAJOR_LAUNCH_RE =
  /(출시|정식\s*공개|오픈\s*소스|오픈소스|오픈\s*웨이트|공개|발표|선보|런칭|인수|투자|IPO|상장|launch|launches|launched|release|releases|released|introduc|unveil|open[- ]?source|open[- ]?weights|acquir|billion|trillion|开源|发布)/i;

const OPEN_OR_BENCHMARK_RE =
  /(apache\s*2\.0|mit\s*license|open[- ]?weights|open[- ]?source|오픈소스|오픈\s*웨이트|무료\s*공개|sota|벤치마크|benchmark|가격\s*인하|토큰\s*단가|开源|免费)/i;

export interface GravityMetrics {
  basePoints: number;
  gravityScore: number;
  hoursSincePublished: number;
  relatedCount: number;
  isFrontierOfficial: boolean;
  isMajorIssue: boolean;
}

export function isFrontierOfficialItem(item: Pick<FeedItem, "platform_id" | "author_handle">): boolean {
  if (FRONTIER_OFFICIAL_PLATFORMS.has(item.platform_id)) return true;
  if (item.platform_id === "x" && item.author_handle) {
    return OFFICIAL_FRONTIER_X_HANDLES.has(item.author_handle.toLowerCase());
  }
  return false;
}

export function hoursSinceItemPublished(
  item: Pick<FeedItem, "published_at" | "created_at">,
  now: number,
): number {
  const iso = item.published_at ?? item.created_at;
  const ts = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ts)) return 48;
  return Math.max(0, (now - Math.min(ts, now)) / 3_600_000);
}

/**
 * 각 기사(또는 클러스터 대표)의 기본 체급 점수(`basePoints`) 산출:
 * 1) 출처 티어 (프론티어 공식 발표 가산점 > 주요 전문지 > 개발자 커뮤니티)
 * 2) 클러스터 보도 매체 수 보너스 (다중 매체 동시 보도 시 대폭 가산)
 * 3) 메이저 릴리즈·오픈소스 공개·화제성 시그널
 */
export function computeBasePoints(
  item: Pick<
    FeedItem,
    | "platform_id"
    | "author_handle"
    | "importance_score"
    | "source_count"
    | "source_platforms"
    | "relatedArticles"
    | "hook_title"
    | "original_title"
    | "benefit_tag"
    | "difficulty"
  >,
): number {
  // 기존 수집/큐레이션 점수를 10~34 범위로 정규화 반영
  const rawScore = Number.isFinite(Number(item.importance_score)) ? Number(item.importance_score) : 20;
  const baseline = Math.min(34, Math.max(8, rawScore * 0.65));

  // ① 출처 티어 가산점
  let sourceBonus = 4;
  if (FRONTIER_OFFICIAL_PLATFORMS.has(item.platform_id)) {
    sourceBonus = 28;
  } else if (item.platform_id === "x" && item.author_handle && OFFICIAL_FRONTIER_X_HANDLES.has(item.author_handle.toLowerCase())) {
    sourceBonus = 22;
  } else if (MAJOR_MEDIA_PLATFORMS.has(item.platform_id)) {
    sourceBonus = 13;
  } else if (CURATED_DEV_PLATFORMS.has(item.platform_id)) {
    sourceBonus = 8;
  }

  // ② 클러스터 보도 매체 수 보너스 (다중 매체 동시 보도 빅이슈 대폭 가산)
  const relatedCount = item.relatedArticles?.length ?? 0;
  const multiSourceExtra = Math.max(relatedCount, Math.max(0, (item.source_count ?? 1) - 1));
  let clusterBonus = 0;
  if (multiSourceExtra >= 1) {
    clusterBonus = Math.min(5, multiSourceExtra) * 24 + (multiSourceExtra >= 2 ? 20 : 0);
  }
  // 클러스터 안에 프론티어 공식 출처가 포함돼 있으면 추가 보너스
  if (
    !FRONTIER_OFFICIAL_PLATFORMS.has(item.platform_id) &&
    item.source_platforms?.some((pid) => FRONTIER_OFFICIAL_PLATFORMS.has(pid))
  ) {
    clusterBonus += 14;
  }

  // ③ 메이저 릴리즈·오픈소스 공개·화제성 시그널
  const headlineBlob = `${item.hook_title} ${item.original_title ?? ""} ${item.benefit_tag ?? ""}`;
  let signalBonus = 0;
  const hasFrontierSubject = FRONTIER_SUBJECT_RE.test(headlineBlob);
  const hasMajorLaunch = MAJOR_LAUNCH_RE.test(headlineBlob);
  if (hasFrontierSubject && hasMajorLaunch) {
    signalBonus += 16;
  } else if (hasFrontierSubject) {
    signalBonus += 6;
  } else if (hasMajorLaunch) {
    signalBonus += 4;
  }

  if (OPEN_OR_BENCHMARK_RE.test(headlineBlob)) signalBonus += 7;
  if (item.benefit_tag?.trim()) signalBonus += 3;
  if (item.difficulty >= 3) signalBonus += 3;

  return Math.round((baseline + sourceBonus + clusterBonus + signalBonus) * 100) / 100;
}

/**
 * HN 시간 중력 공식: `basePoints / Math.pow(hoursSincePublished + 2, 1.8)`
 */
export function computeGravityScore(basePoints: number, hoursSincePublished: number): number {
  const safeHours = Math.max(0, hoursSincePublished);
  return basePoints / Math.pow(safeHours + GRAVITY_TIME_OFFSET_HOURS, GRAVITY_EXPONENT);
}

/**
 * 중요 기사(주요 이슈) 판별 기준:
 * - 관련 보도 2건 이상 묶인 빅이슈 (총 3개 매체 이상 보도), OR
 * - 프론티어 공식 발표(OpenAI·Anthropic·Google DeepMind·DeepSeek·Qwen 등)이면서 체급 충분, OR
 * - 관련 보도 1건 이상 + 체급 상위권(`basePoints >= 64`), OR
 * - 단독 기사라도 초고체급(`basePoints >= 68`)
 */
export function computeGravityMetrics(
  item: Pick<
    FeedItem,
    | "platform_id"
    | "author_handle"
    | "importance_score"
    | "source_count"
    | "source_platforms"
    | "relatedArticles"
    | "hook_title"
    | "original_title"
    | "benefit_tag"
    | "difficulty"
    | "published_at"
    | "created_at"
  >,
  now: number,
): GravityMetrics {
  const basePoints = computeBasePoints(item);
  const hoursSincePublished = hoursSinceItemPublished(item, now);
  const gravityScore = computeGravityScore(basePoints, hoursSincePublished);
  const relatedCount = item.relatedArticles?.length ?? 0;
  const multiSourceExtra = Math.max(relatedCount, Math.max(0, (item.source_count ?? 1) - 1));
  const isFrontierOfficial = isFrontierOfficialItem(item);

  const isMajorIssue =
    relatedCount >= 2 ||
    multiSourceExtra >= 2 ||
    (isFrontierOfficial && basePoints >= 56) ||
    (multiSourceExtra >= 1 && basePoints >= 64) ||
    basePoints >= 68;

  return {
    basePoints,
    gravityScore,
    hoursSincePublished,
    relatedCount,
    isFrontierOfficial,
    isMajorIssue,
  };
}

/** 지난 주요 소식(warm, 8~30일)용 중력 체급 점수: 체급 점수 우선 + 완만한 경과일 감쇠 */
export function warmGravityScore(item: FeedItem, now?: number): number {
  const basePoints = computeBasePoints(item);
  if (now === undefined) return basePoints;
  const ageDays = hoursSinceItemPublished(item, now) / 24;
  return basePoints / Math.pow(Math.max(0, ageDays) + 7, 0.35);
}

/** 고중력 상단 부력 자격: 12시간 이내 + 미열람 + 주요 이슈(또는 고중력 상위 티어) */
export function isBuoyantHighGravity(
  item: FeedItem,
  metrics: GravityMetrics,
  readIds?: ReadonlySet<string>,
): boolean {
  if (metrics.hoursSincePublished > GRAVITY_BUOYANCY_HOURS) return false;
  if (readIds && isClusterRead(item, readIds)) return false;
  if (metrics.isMajorIssue && metrics.gravityScore >= 1.1) return true;
  return false;
}

/** 기사 또는 클러스터에 묶인 관련 기사 ID가 읽음 목록에 있는지 확인 */
export function isClusterRead(item: Pick<FeedItem, "id" | "relatedArticles">, readIds?: ReadonlySet<string>): boolean {
  if (!readIds || readIds.size === 0) return false;
  if (readIds.has(item.id)) return true;
  if (item.relatedArticles?.some((r) => readIds.has(r.id))) return true;
  return false;
}
