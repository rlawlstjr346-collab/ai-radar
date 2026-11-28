import "server-only";

import { createHash } from "node:crypto";

import samplePlatforms from "@/data/platforms.sample.json";

import { synthesizeEasyOriginal } from "./easy-synth";
import { loadLiveSnapshot, loadLiveSnapshotAsync, type LiveSnapshot } from "./live-snapshot";
import { getHighlightSummary, getPlanningMeta, getUtilityInsight } from "./reading-insights";
import type { Category, Difficulty, EasyOriginal, Entity, FeedItem, Platform, Term } from "./types";

const PLATFORMS = samplePlatforms as Platform[];
const PLATFORMS_BY_ID = new Map<string, Platform>(PLATFORMS.map((p) => [p.id, p]));

const DEFAULT_SOURCE_TIMEOUT_MS = 3_000;
const DEFAULT_TRANSLATE_TIMEOUT_MS = 2_800;
const LIVE_FRESH_WINDOW_HOURS = 72;
const HOT_FRESH_CUTOFF_HOURS = 48;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_NEW_ITEMS_PER_CYCLE = 18;
const MAX_FEED_ITEMS = 100;
const MAX_HOT_ITEMS = 70;
const MAX_WARM_ITEMS = 30;
const RESPONSE_CACHE_TTL_MS = 180_000; // 3분 서버 인메모리 캐시

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VALID_HTTPS_RE = /^https:\/\/[^/\s]+\.[^/\s]+/;
const BAD_HOST_RE = /(?:^|\/\/)(?:[^/]*\.)?(?:example\.(?:com|org)|localhost|127\.0\.0\.1)(?:[:/]|$)/i;
const HANGUL_RE = /[가-힣]/g;
const JP_KANA_RE = /[\u3040-\u30ff]/;
const CJK_HAN_RE = /[\u4e00-\u9fff]/;
const LANG_CHAR_RE = /[가-힣A-Za-z\u3040-\u30ff\u4e00-\u9fff]/g;
const URL_IN_TEXT_RE = /https?:\/\/\S+/g;
const X_STATUS_RE = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{6,25})/g;
const X_NOT_HANDLES = new Set(["i", "home", "intent", "share", "search", "hashtag"]);

const AI_SIGNAL_RE =
  /(\bA\.?I\b|인공지능|\bLLMs?\b|\bGPT[-\w.]*|ChatGPT|에이전트|\bagents?\b|\bagentic\b|머신러닝|딥러닝|\bML\b|machine learning|deep learning|생성형|\bRAG\b|프롬프트|prompt|임베딩|embedding|Claude|Gemini|OpenAI|Anthropic|DeepMind|Llama|Qwen|DeepSeek|Mistral|Grok|Kimi|GLM|transformer|트랜스포머|파인튜닝|fine-?tun|inference|추론|\bMCP\b|vLLM|Ollama|ComfyUI|Cursor|Windsurf|Codex|코파일럿|copilot|챗봇|chatbot|모델|반도체|GPU|NPU|엔비디아|NVIDIA|生成AI|人工知能|機械学習|大模型|大语言模型|语言模型|多模态|智能体|开源模型|开源|通义千问|深度求索|智谱|月之暗面)/i;

const CN_BUILDER_LAUNCH_RE =
  /(独立开发|开源|开源了|发布了|上线了|做了个|写了个|开发了一个|自研|副业项目|个人项目|Chrome\s*插件|浏览器扩展|CLI\s*工具|Web\s*应用|SaaS|工作流|Workflow|github\.com\/|huggingface\.co\/|demo|在线体验)/i;

const BLOCKED_NOISE_RE =
  /(독서\s*모임|스터디\s*모집|채용\s*공고|인재\s*채용|할인\s*쿠폰|무료\s*특강\s*모집|선착순\s*모집|giveaway|airdrop|memecoin|sponsored|entertainment|娱乐|明星|八卦|房产|楼市|房价|A股|涨停|跌停|招聘|内推|求职|出闲置|二手转让|电动车销量|新能源车销量|fuck(?:ing)?|\bshit\b)/i;

const CATEGORY_LABELS: Record<Category, string> = {
  llm_chat: "챗봇·생산성",
  dev: "코딩·에이전트",
  image_design: "이미지·디자인",
  video_audio: "영상·음성",
  research: "논문·연구",
  industry: "빅테크·트렌드",
  social: "커뮤니티·화제",
};

const CATEGORY_WHY: Record<Category, string> = {
  llm_chat: "일상 업무나 대화형 AI 선택에 바로 영향을 줄 수 있는 실시간 업데이트예요. 원문에서 지원 범위와 요금 조건을 함께 살펴보세요.",
  dev: "개발 워크플로와 코딩 에이전트 활용에 바로 참고할 실무 변화예요. 원문의 변경 사항과 코드·데모 예시를 먼저 확인해 보세요.",
  image_design: "이미지 생성·편집 작업 품질과 워크플로에 참고할 최신 소식이에요. 원문의 결과 샘플과 라이선스 조건을 함께 보세요.",
  video_audio: "영상·음성 제작 도구 흐름을 파악하는 데 도움이 되는 실시간 소식이에요. 원문에 공개된 데모 결과물을 직접 확인해 보세요.",
  research: "차세대 모델과 알고리즘 방향을 먼저 짚어 볼 수 있는 최신 연구예요. 원문의 초록과 실험 요약 표부터 훑어보면 이해가 빨라요.",
  industry: "AI 생태계와 서비스 가격·정책 흐름을 읽는 데 중요한 업계 속보예요. 원문에 적힌 수치와 적용 시점을 확인해 보세요.",
  social: "글로벌 AI 빌더와 개발자 커뮤니티에서 지금 막 논의되는 실시간 화제예요. 원문 스레드와 댓글 반응을 함께 보면 맥락이 또렷해져요.",
};

const KNOWN_TERMS: ReadonlyArray<[string, string]> = [
  ["LLM", "수많은 글을 학습해 사람처럼 문장을 이해하고 쓰는 대규모 언어 모델이에요."],
  ["RAG", "AI가 답하기 전에 외부 문서에서 필요한 근거를 먼저 찾아 참고하는 방식이에요."],
  ["MCP", "AI 모델이 외부 도구·파일·데이터베이스와 표준 규격으로 연결되도록 돕는 통신 약속이에요."],
  ["vLLM", "오픈소스 AI 모델을 적은 메모리로 빠르게 여러 사람에게 서비스하게 해 주는 추론 엔진이에요."],
  ["API", "다른 프로그램이나 웹사이트가 AI 기능을 코드로 불러다 쓸 수 있게 열어 둔 연결 통로예요."],
  ["GPU", "AI 모델 학습과 실행에 필요한 대량 계산을 동시에 처리하는 그래픽 연산 칩이에요."],
  ["에이전트", "질문에 답만 하는 수준을 넘어 도구를 쓰고 여러 단계 작업을 스스로 이어 가는 AI예요."],
  ["오픈소스", "설계도(코드나 모델 가중치)가 공개돼 누구나 살펴보고 조건에 맞게 활용할 수 있는 형태예요."],
  ["파인튜닝", "이미 만들어진 AI에 특정 분야 데이터를 추가로 익혀 맞춤 실력을 높이는 작업이에요."],
  ["벤치마크", "여러 AI 모델의 실력을 같은 시험 문제로 비교해 점수 매기는 표준 평가예요."],
  ["토큰", "AI가 글을 읽고 쓸 때 쪼개는 최소 글자·단어 조각 단위예요."],
];

const KNOWN_ENTITIES: ReadonlyArray<[string, string, string[]]> = [
  ["OpenAI", "company", ["openai", "ai-lab"]],
  ["Anthropic", "company", ["anthropic", "ai-lab"]],
  ["Google DeepMind", "company", ["google", "ai-lab"]],
  ["Claude Code", "tool", ["anthropic", "claude", "coding"]],
  ["Claude", "model", ["anthropic", "claude", "llm"]],
  ["Gemini", "model", ["google", "gemini", "llm"]],
  ["GPT-5", "model", ["openai", "gpt", "llm"]],
  ["GPT-4o", "model", ["openai", "gpt", "llm"]],
  ["ChatGPT", "tool", ["openai", "llm"]],
  ["DeepSeek", "model", ["deepseek", "open-weights", "llm"]],
  ["Qwen", "model", ["qwen", "open-weights", "llm"]],
  ["Kimi", "model", ["moonshot", "kimi", "llm"]],
  ["GLM", "model", ["zhipu", "glm", "open-weights"]],
  ["Llama", "model", ["meta", "open-weights", "llm"]],
  ["Mistral", "model", ["mistral", "open-weights", "llm"]],
  ["Grok", "model", ["xai", "llm"]],
  ["Cursor", "tool", ["coding", "agent"]],
  ["Ollama", "tool", ["local-llm", "open-source"]],
  ["vLLM", "tool", ["inference", "open-source"]],
  ["Hugging Face", "platform", ["open-source", "models"]],
  ["NVIDIA", "company", ["gpu", "hardware"]],
  ["Simon Willison", "person", ["developer"]],
];

export type LiveSourceKind = "rss" | "hn_algolia" | "v2ex" | "juejin" | "kr36" | "x_hn_oembed" | "x_syndication";

export interface LiveHarvestSource {
  id: string;
  platformId: string;
  name: string;
  kind: LiveSourceKind;
  url: string;
  defaultCategory: Category;
  filterAi: boolean;
  baseScore: number;
  maxItems: number;
  region: "kr" | "global" | "cn" | "social";
}

export const LIVE_HARVEST_SOURCES: ReadonlyArray<LiveHarvestSource> = [
  {
    id: "openai-rss",
    platformId: "openai",
    name: "OpenAI News",
    kind: "rss",
    url: "https://openai.com/news/rss.xml",
    defaultCategory: "industry",
    filterAi: false,
    baseScore: 34,
    maxItems: 4,
    region: "global",
  },
  {
    id: "verge-ai-rss",
    platformId: "the-verge-ai",
    name: "The Verge AI",
    kind: "rss",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    defaultCategory: "industry",
    filterAi: false,
    baseScore: 30,
    maxItems: 5,
    region: "global",
  },
  {
    id: "techcrunch-ai-rss",
    platformId: "techcrunch-ai",
    name: "TechCrunch AI",
    kind: "rss",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    defaultCategory: "industry",
    filterAi: false,
    baseScore: 30,
    maxItems: 5,
    region: "global",
  },
  {
    id: "simon-willison-atom",
    platformId: "simon-willison",
    name: "Simon Willison",
    kind: "rss",
    url: "https://simonwillison.net/atom/everything/",
    defaultCategory: "dev",
    filterAi: true,
    baseScore: 29,
    maxItems: 4,
    region: "global",
  },
  {
    id: "hn-ai",
    platformId: "hacker-news",
    name: "Hacker News AI",
    kind: "hn_algolia",
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI&hitsPerPage=20&numericFilters=points%3E%3D20",
    defaultCategory: "dev",
    filterAi: true,
    baseScore: 28,
    maxItems: 5,
    region: "global",
  },
  {
    id: "hn-show",
    platformId: "hacker-news",
    name: "Show HN AI",
    kind: "hn_algolia",
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=25&numericFilters=points%3E%3D10",
    defaultCategory: "dev",
    filterAi: true,
    baseScore: 27,
    maxItems: 4,
    region: "global",
  },
  {
    id: "geeknews-rss",
    platformId: "geeknews",
    name: "GeekNews",
    kind: "rss",
    url: "https://news.hada.io/rss/news",
    defaultCategory: "social",
    filterAi: true,
    baseScore: 28,
    maxItems: 5,
    region: "kr",
  },
  {
    id: "aitimes-rss",
    platformId: "aitimes",
    name: "AI타임스",
    kind: "rss",
    url: "https://www.aitimes.com/rss/allArticle.xml",
    defaultCategory: "industry",
    filterAi: true,
    baseScore: 30,
    maxItems: 5,
    region: "kr",
  },
  {
    id: "v2ex-create",
    platformId: "v2ex",
    name: "V2EX create",
    kind: "v2ex",
    url: "https://www.v2ex.com/api/topics/show.json?node_name=create",
    defaultCategory: "social",
    filterAi: true,
    baseScore: 26,
    maxItems: 4,
    region: "cn",
  },
  {
    id: "v2ex-ai",
    platformId: "v2ex",
    name: "V2EX ai",
    kind: "v2ex",
    url: "https://www.v2ex.com/api/topics/show.json?node_name=ai",
    defaultCategory: "social",
    filterAi: true,
    baseScore: 27,
    maxItems: 4,
    region: "cn",
  },
  {
    id: "juejin-ai",
    platformId: "juejin",
    name: "Juejin AI",
    kind: "juejin",
    url: "https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed",
    defaultCategory: "dev",
    filterAi: true,
    baseScore: 27,
    maxItems: 5,
    region: "cn",
  },
  {
    id: "qbitai-rss",
    platformId: "qbitai",
    name: "QbitAI",
    kind: "rss",
    url: "https://www.qbitai.com/feed",
    defaultCategory: "industry",
    filterAi: true,
    baseScore: 29,
    maxItems: 5,
    region: "cn",
  },
  {
    id: "36kr-ai-api",
    platformId: "36kr-ai",
    name: "36Kr AI",
    kind: "kr36",
    url: "https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow",
    defaultCategory: "industry",
    filterAi: true,
    baseScore: 29,
    maxItems: 5,
    region: "cn",
  },
  {
    id: "substack-latent-space",
    platformId: "latent-space",
    name: "Substack · Latent Space",
    kind: "rss",
    url: "https://www.latent.space/feed",
    defaultCategory: "industry",
    filterAi: false,
    baseScore: 28,
    maxItems: 3,
    region: "global",
  },
  {
    id: "substack-import-ai",
    platformId: "import-ai",
    name: "Substack · Import AI",
    kind: "rss",
    url: "https://importai.substack.com/feed",
    defaultCategory: "research",
    filterAi: false,
    baseScore: 28,
    maxItems: 3,
    region: "global",
  },
  {
    id: "substack-ahead-of-ai",
    platformId: "ahead-of-ai",
    name: "Substack · Ahead of AI",
    kind: "rss",
    url: "https://magazine.sebastianraschka.com/feed",
    defaultCategory: "research",
    filterAi: false,
    baseScore: 28,
    maxItems: 3,
    region: "global",
  },
  {
    id: "x-realtime-hn",
    platformId: "x",
    name: "X 실시간",
    kind: "x_hn_oembed",
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=x.com%20status&hitsPerPage=15",
    defaultCategory: "social",
    filterAi: true,
    baseScore: 29,
    maxItems: 4,
    region: "social",
  },
  {
    id: "x-syndication-openai",
    platformId: "x",
    name: "X @OpenAI",
    kind: "x_syndication",
    url: "https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI",
    defaultCategory: "social",
    filterAi: false,
    baseScore: 31,
    maxItems: 2,
    region: "social",
  },
  {
    id: "x-syndication-anthropic",
    platformId: "x",
    name: "X @AnthropicAI",
    kind: "x_syndication",
    url: "https://syndication.twitter.com/srv/timeline-profile/screen-name/AnthropicAI",
    defaultCategory: "social",
    filterAi: false,
    baseScore: 31,
    maxItems: 2,
    region: "social",
  },
];

export interface RawHarvestItem {
  platformId: string;
  category: Category;
  url: string;
  title: string;
  body: string;
  publishedAt: string | null;
  thumbnailUrl?: string | null;
  authorHandle?: string | null;
  score: number;
  region: "kr" | "global" | "cn" | "social";
}

export type LiveFeedWireItem = FeedItem & { easy_original?: EasyOriginal };

export interface LiveFeedApiPayload {
  version: 1;
  generated_at: string;
  snapshot_generated_at: string | null;
  harvested_at: string;
  live_added_count: number;
  item_count: number;
  items: LiveFeedWireItem[];
}

export interface LiveFeedDeps {
  fetchImpl?: typeof fetch;
  loadSnapshot?: () => Promise<LiveSnapshot>;
  now?: Date;
  sources?: ReadonlyArray<LiveHarvestSource>;
  sourceTimeoutMs?: number;
  translateTimeoutMs?: number;
  translateFn?: (text: string) => Promise<string | null>;
  bypassCache?: boolean;
}

// ── 인메모리 캐시 (번역 캐시 + 최근 응답 캐시 + 동적 기사 easy_original 조회) ──────
const translationMemo = new Map<string, string>();
const MAX_TRANSLATION_MEMO = 600;
const liveEdgeItemMemo = new Map<string, { item: FeedItem; easy: EasyOriginal }>();
const MAX_LIVE_EDGE_MEMO = 200;

let cachedResponse: { expiresAt: number; payload: LiveFeedApiPayload } | null = null;
let inflightBuild: Promise<LiveFeedApiPayload> | null = null;

export function clearLiveHarvesterCaches(): void {
  cachedResponse = null;
  inflightBuild = null;
  translationMemo.clear();
  liveEdgeItemMemo.clear();
}

export function getCachedLiveEdgeItem(id: string): { item: FeedItem; easy: EasyOriginal } | null {
  return liveEdgeItemMemo.get(id) ?? null;
}

// ── 텍스트·URL 정규화 및 XML/HTML 유틸 ──────────────────────────────────────────
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

export function stripHtml(raw: string, maxLen = 1600): string {
  if (!raw) return "";
  const cleaned = decodeHtmlEntities(raw)
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen).replace(/\s+\S*$/, "")}…` : cleaned;
}

function sanitizeKoreanCopy(text: string): string {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/혁신적(?:인|으로)?/g, "새로운")
    .replace(/획기적(?:인|으로)?/g, "눈에 띄는")
    .replace(/패러다임(?:\s*시프트)?/g, "흐름")
    .replace(/게임\s*체인저/g, "전환점")
    .replace(/충격|경악|역대급|미쳤다|무조건/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrlForDedup(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const dropKeys: string[] = [];
    u.searchParams.forEach((_v, k) => {
      const lk = k.toLowerCase();
      if (lk.startsWith("utm_") || lk === "ref" || lk === "source" || lk === "fbclid" || lk === "gclid") {
        dropKeys.push(k);
      }
    });
    for (const k of dropKeys) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function normalizeTitleForDedup(title: string): string {
  return decodeHtmlEntities(title || "")
    .toLowerCase()
    .replace(/^@[a-z0-9_]{1,15}:\s*/i, "")
    .replace(/[^0-9a-z가-힣\u3040-\u30ff\u4e00-\u9fff]+/g, "")
    .trim();
}

export function isValidHttpsUrl(url: string): boolean {
  return Boolean(url && VALID_HTTPS_RE.test(url) && !BAD_HOST_RE.test(url));
}

export function containsUntranslatedCjk(text: string): boolean {
  if (!text) return false;
  const cleaned = text.replace(URL_IN_TEXT_RE, "");
  return CJK_HAN_RE.test(cleaned) || JP_KANA_RE.test(cleaned);
}

export function hangulRatio(text: string): number {
  if (!text) return 1;
  const cleaned = text.replace(URL_IN_TEXT_RE, "");
  const langChars = cleaned.match(LANG_CHAR_RE) ?? [];
  if (langChars.length === 0) return 1;
  const hangulChars = cleaned.match(HANGUL_RE) ?? [];
  return hangulChars.length / langChars.length;
}

export function needsKoreanTranslation(text: string, threshold = 0.2): boolean {
  if (!text || !text.trim()) return false;
  const cleaned = text.replace(URL_IN_TEXT_RE, "").trim();
  if (containsUntranslatedCjk(cleaned)) return true;
  const langChars = cleaned.match(LANG_CHAR_RE) ?? [];
  if (langChars.length < 4) return false;
  return hangulRatio(cleaned) < threshold;
}

function normalizeTimestamp(raw: string | number | null | undefined, now: Date, region: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let ms = Number.NaN;
  if (typeof raw === "number") {
    const ts = raw > 1e12 ? raw : raw > 1e8 ? raw * 1000 : Number.NaN;
    ms = ts;
  } else if (/^\d{9,13}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    ms = n > 1e12 ? n : n * 1000;
  } else {
    ms = Date.parse(raw.trim());
  }
  if (Number.isNaN(ms)) return null;

  const nowMs = now.getTime();
  if (ms > nowMs + FUTURE_TOLERANCE_MS) {
    if (region === "kr" && ms - 9 * 3_600_000 <= nowMs + FUTURE_TOLERANCE_MS) {
      ms -= 9 * 3_600_000;
    } else if (region === "cn" && ms - 8 * 3_600_000 <= nowMs + FUTURE_TOLERANCE_MS) {
      ms -= 8 * 3_600_000;
    } else {
      return null;
    }
  }
  if (ms > nowMs) ms = nowMs;
  return new Date(ms).toISOString();
}

function classifyNews(title: string, fallback: Category): Category {
  const low = title.toLowerCase();
  if (/(arxiv|paper|benchmark|dataset|ablation|논문|벤치마크|论文)/i.test(low)) return "research";
  if (/(github|open[- ]?source|sdk|cli|api|mcp|agent|cursor|vllm|ollama|오픈소스|에이전트|开源|插件)/i.test(low)) {
    return fallback === "social" ? "social" : "dev";
  }
  if (/(midjourney|flux|comfyui|stable diffusion|image generation|이미지 생성)/i.test(low)) return "image_design";
  if (/(sora|veo|kling|runway|suno|elevenlabs|voice|video model|영상 생성|음성)/i.test(low)) return "video_audio";
  if (/(chatgpt|claude\.ai|gemini app|chatbot|챗봇)/i.test(low) && fallback === "industry") return "llm_chat";
  return fallback;
}

// ── 경량 RSS 2.0 / Atom XML 파서 ────────────────────────────────────────────────
export interface ParsedFeedEntry {
  title: string;
  link: string;
  body: string;
  publishedRaw: string | null;
  thumbnailUrl: string | null;
}

function extractTag(block: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = re.exec(block);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function extractLink(block: string, fallbackBaseUrl?: string): string {
  // Atom <link rel="alternate" href="..."/> 우선
  const atomAlternate = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  const atomHref = atomAlternate ?? /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  let raw = atomHref?.[1]?.trim() || extractTag(block, ["link", "guid"]);
  raw = decodeHtmlEntities(raw).trim();
  if (!raw) return "";
  if (raw.startsWith("http://")) raw = `https://${raw.slice(7)}`;
  if (!raw.startsWith("https://") && fallbackBaseUrl) {
    try {
      raw = new URL(raw, fallbackBaseUrl).toString();
    } catch {
      return "";
    }
  }
  return raw;
}

function extractThumbnail(block: string): string | null {
  const m =
    /<media:(?:thumbnail|content)\b[^>]*url=["'](https:\/\/[^"']+)["']/i.exec(block) ??
    /<enclosure\b[^>]*type=["']image\/[^"']*["'][^>]*url=["'](https:\/\/[^"']+)["']/i.exec(block);
  return m?.[1] && isValidHttpsUrl(m[1]) ? m[1] : null;
}

export function parseRssOrAtomXml(xml: string, fallbackBaseUrl?: string): ParsedFeedEntry[] {
  if (!xml) return [];
  const head = xml.slice(0, 400).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return [];

  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  const out: ParsedFeedEntry[] = [];
  for (const match of blocks) {
    const block = match[1] ?? "";
    const title = stripHtml(extractTag(block, ["title"]), 240);
    const link = extractLink(block, fallbackBaseUrl);
    if (!title || !link || !isValidHttpsUrl(link)) continue;
    const rawBody = extractTag(block, ["content:encoded", "content", "description", "summary"]);
    const body = stripHtml(rawBody, 1600);
    const publishedRaw =
      decodeHtmlEntities(extractTag(block, ["pubDate", "published", "updated", "dc:date", "date"])).trim() || null;
    out.push({
      title,
      link,
      body,
      publishedRaw,
      thumbnailUrl: extractThumbnail(block),
    });
  }
  return out;
}

// ── 타임아웃 보장 fetch 래퍼 ────────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 무료 한국어 자동 번역기 (Google GTX → clients5 + 인메모리 캐시) ─────────────
function detectGoogleSourceLang(text: string): string {
  if (JP_KANA_RE.test(text)) return "ja";
  if (CJK_HAN_RE.test(text)) return "zh-CN";
  return "auto";
}

export async function translateToKorean(
  text: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TRANSLATE_TIMEOUT_MS,
): Promise<string | null> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 900);
  if (!clean) return "";
  if (!needsKoreanTranslation(clean)) return clean;

  const cacheHit = translationMemo.get(clean);
  if (cacheHit) return cacheHit;

  const sl = detectGoogleSourceLang(clean);

  // 1순위: Google Translate GTX 무료 공개 JSON 엔드포인트
  const gtxParams = new URLSearchParams({ client: "gtx", sl, tl: "ko", dt: "t", q: clean });
  const gtxRes = await fetchWithTimeout(
    `https://translate.googleapis.com/translate_a/single?${gtxParams.toString()}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    timeoutMs,
    fetchImpl,
  );
  if (gtxRes) {
    try {
      const data = (await gtxRes.json()) as unknown;
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = (data[0] as unknown[])
          .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
          .join("")
          .trim();
        if (translated && !containsUntranslatedCjk(translated)) {
          rememberTranslation(clean, translated);
          return translated;
        }
      }
    } catch {
      // fall through to secondary endpoint
    }
  }

  // 2순위: clients5 무료 공개 엔드포인트
  const c5Params = new URLSearchParams({ client: "dict-chrome-ex", sl, tl: "ko", q: clean });
  const c5Res = await fetchWithTimeout(
    `https://clients5.google.com/translate_a/t?${c5Params.toString()}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    timeoutMs,
    fetchImpl,
  );
  if (c5Res) {
    try {
      const data = (await c5Res.json()) as unknown;
      let translated = "";
      if (Array.isArray(data) && data.length > 0) {
        if (typeof data[0] === "string") translated = data[0].trim();
        else if (Array.isArray(data[0]) && typeof data[0][0] === "string") translated = data[0][0].trim();
      }
      if (translated && !containsUntranslatedCjk(translated)) {
        rememberTranslation(clean, translated);
        return translated;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function rememberTranslation(src: string, dst: string): void {
  if (translationMemo.size >= MAX_TRANSLATION_MEMO) {
    const firstKey = translationMemo.keys().next().value;
    if (firstKey !== undefined) translationMemo.delete(firstKey);
  }
  translationMemo.set(src, dst);
}

// ── 소스별 초경량 델타 수집기 ───────────────────────────────────────────────────
function isRelevantForSource(source: LiveHarvestSource, title: string, body: string): boolean {
  if (!title || title.length < 6) return false;
  if (BLOCKED_NOISE_RE.test(title) || BLOCKED_NOISE_RE.test(body.slice(0, 400))) return false;
  if (!source.filterAi) return true;
  if (source.kind === "v2ex") {
    return AI_SIGNAL_RE.test(title) || (CN_BUILDER_LAUNCH_RE.test(title) && AI_SIGNAL_RE.test(`${title} ${body.slice(0, 500)}`));
  }
  return AI_SIGNAL_RE.test(title) || AI_SIGNAL_RE.test(body.slice(0, 500));
}

interface SourceFetchResult {
  ok: boolean;
  items: RawHarvestItem[];
}

async function fetchOneSource(
  source: LiveHarvestSource,
  now: Date,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<SourceFetchResult> {
  const cutoffMs = now.getTime() - LIVE_FRESH_WINDOW_HOURS * 3_600_000;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  };

  if (source.kind === "rss") {
    const res = await fetchWithTimeout(source.url, { headers }, timeoutMs, fetchImpl);
    if (!res) return { ok: false, items: [] };
    const xml = await res.text();
    const entries = parseRssOrAtomXml(xml, source.url);
    const out: RawHarvestItem[] = [];
    for (const e of entries) {
      const pub = normalizeTimestamp(e.publishedRaw, now, source.region);
      if (pub && Date.parse(pub) < cutoffMs) continue;
      if (!isRelevantForSource(source, e.title, e.body)) continue;
      out.push({
        platformId: source.platformId,
        category: classifyNews(e.title, source.defaultCategory),
        url: e.link,
        title: e.title,
        body: e.body,
        publishedAt: pub,
        thumbnailUrl: e.thumbnailUrl,
        score: source.baseScore,
        region: source.region,
      });
      if (out.length >= source.maxItems) break;
    }
    return { ok: true, items: out };
  }

  if (source.kind === "hn_algolia") {
    const res = await fetchWithTimeout(source.url, { headers }, timeoutMs, fetchImpl);
    if (!res) return { ok: false, items: [] };
    const json = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    const out: RawHarvestItem[] = [];
    for (const hit of json.hits ?? []) {
      const oid = String(hit.objectID ?? "").trim();
      const title = stripHtml(String(hit.title ?? ""), 240);
      const hnUrl = oid ? `https://news.ycombinator.com/item?id=${oid}` : "";
      const rawUrl = typeof hit.url === "string" && isValidHttpsUrl(hit.url) ? hit.url.trim() : hnUrl;
      const body = stripHtml(String(hit.story_text ?? ""), 1200);
      const pub = normalizeTimestamp(typeof hit.created_at === "string" ? hit.created_at : null, now, source.region);
      if (!rawUrl || !title || !isValidHttpsUrl(rawUrl)) continue;
      if (pub && Date.parse(pub) < cutoffMs) continue;
      if (!isRelevantForSource(source, title, body)) continue;
      const points = Number(hit.points ?? 0);
      out.push({
        platformId: source.platformId,
        category: classifyNews(title, source.defaultCategory),
        url: rawUrl,
        title,
        body: body || `${title} — Hacker News 커뮤니티 화제(${points}pt).`,
        publishedAt: pub,
        score: source.baseScore + Math.min(8, points / 40),
        region: source.region,
      });
      if (out.length >= source.maxItems) break;
    }
    return { ok: true, items: out };
  }

  if (source.kind === "v2ex") {
    const res = await fetchWithTimeout(
      source.url,
      { headers: { ...headers, Referer: "https://www.v2ex.com/" } },
      timeoutMs,
      fetchImpl,
    );
    if (!res) return { ok: false, items: [] };
    const topics = (await res.json()) as unknown;
    if (!Array.isArray(topics)) return { ok: false, items: [] };
    const out: RawHarvestItem[] = [];
    for (const t of topics as Array<Record<string, unknown>>) {
      const tid = t?.id;
      const title = stripHtml(String(t?.title ?? ""), 240);
      const body = stripHtml(String(t?.content ?? ""), 1400);
      const link = typeof t?.url === "string" && isValidHttpsUrl(t.url) ? t.url : tid ? `https://www.v2ex.com/t/${tid}` : "";
      const pub = normalizeTimestamp(typeof t?.created === "number" ? t.created : null, now, source.region);
      if (!link || !title || !isValidHttpsUrl(link)) continue;
      if (pub && Date.parse(pub) < cutoffMs) continue;
      if (!isRelevantForSource(source, title, body)) continue;
      const replies = Number(t?.replies ?? 0);
      out.push({
        platformId: source.platformId,
        category: /(github\.com|开源|mcp|cli|sdk|api|agent)/i.test(`${title} ${body}`) ? "dev" : "social",
        url: link,
        title,
        body,
        publishedAt: pub,
        score: source.baseScore + Math.min(6, replies * 0.2),
        region: source.region,
      });
      if (out.length >= source.maxItems) break;
    }
    return { ok: true, items: out };
  }

  if (source.kind === "juejin") {
    const res = await fetchWithTimeout(
      source.url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Referer: "https://juejin.cn/ai",
          Origin: "https://juejin.cn",
        },
        body: JSON.stringify({
          id_type: 2,
          sort_type: 300,
          cate_id: "6809637773935378440",
          cursor: "0",
          limit: 15,
        }),
      },
      timeoutMs,
      fetchImpl,
    );
    if (!res) return { ok: false, items: [] };
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const out: RawHarvestItem[] = [];
    for (const row of json.data ?? []) {
      const info = (row?.article_info ?? {}) as Record<string, unknown>;
      const aid = String(row?.article_id ?? info.article_id ?? "").trim();
      const title = stripHtml(String(info.title ?? ""), 240);
      const body = stripHtml(String(info.brief_content ?? ""), 1400);
      if (!aid || !title) continue;
      const link = `https://juejin.cn/post/${aid}`;
      const pub = normalizeTimestamp((info.ctime ?? info.rtime) as string | number | undefined, now, source.region);
      if (pub && Date.parse(pub) < cutoffMs) continue;
      if (!isRelevantForSource(source, title, body)) continue;
      out.push({
        platformId: source.platformId,
        category: classifyNews(title, source.defaultCategory),
        url: link,
        title,
        body,
        publishedAt: pub,
        score: source.baseScore,
        region: source.region,
      });
      if (out.length >= source.maxItems) break;
    }
    return { ok: true, items: out };
  }

  if (source.kind === "kr36") {
    const res = await fetchWithTimeout(
      source.url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Referer: "https://36kr.com/information/AI/",
          Origin: "https://36kr.com",
        },
        body: JSON.stringify({
          partner_id: "web",
          timestamp: now.getTime(),
          param: {
            subnavType: 1,
            subnavNick: "AI",
            pageSize: 15,
            pageEvent: 0,
            siteId: 1,
            platformId: 2,
          },
        }),
      },
      timeoutMs,
      fetchImpl,
    );
    if (!res) return { ok: false, items: [] };
    const json = (await res.json()) as { data?: { itemList?: Array<Record<string, unknown>> } };
    const out: RawHarvestItem[] = [];
    for (const row of json.data?.itemList ?? []) {
      const mat = (row?.templateMaterial ?? {}) as Record<string, unknown>;
      const itemId = String(row?.itemId ?? mat.itemId ?? "").trim();
      const title = stripHtml(String(mat.widgetTitle ?? ""), 240);
      const body = stripHtml(String(mat.summary ?? ""), 1400);
      if (!itemId || !title) continue;
      const link = `https://36kr.com/p/${itemId}`;
      const pub = normalizeTimestamp(mat.publishTime as string | number | undefined, now, source.region);
      if (pub && Date.parse(pub) < cutoffMs) continue;
      if (!isRelevantForSource(source, title, body)) continue;
      const thumb = typeof mat.widgetImage === "string" && isValidHttpsUrl(mat.widgetImage) ? mat.widgetImage : null;
      out.push({
        platformId: source.platformId,
        category: classifyNews(title, source.defaultCategory),
        url: link,
        title,
        body,
        publishedAt: pub,
        thumbnailUrl: thumb,
        score: source.baseScore,
        region: source.region,
      });
      if (out.length >= source.maxItems) break;
    }
    return { ok: true, items: out };
  }

  if (source.kind === "x_hn_oembed") {
    const res = await fetchWithTimeout(source.url, { headers }, timeoutMs, fetchImpl);
    if (!res) return { ok: false, items: [] };
    const json = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    const candidates: Array<{ url: string; handle: string; pub: string | null; titleHint: string }> = [];
    const seenStatus = new Set<string>();
    for (const hit of json.hits ?? []) {
      const blob = `${String(hit.url ?? "")} ${String(hit.story_text ?? "")}`;
      const pub = normalizeTimestamp(typeof hit.created_at === "string" ? hit.created_at : null, now, "social");
      if (pub && Date.parse(pub) < cutoffMs) continue;
      for (const m of blob.matchAll(X_STATUS_RE)) {
        const handle = m[1];
        const sid = m[2];
        if (!handle || !sid || X_NOT_HANDLES.has(handle.toLowerCase()) || seenStatus.has(sid)) continue;
        seenStatus.add(sid);
        candidates.push({
          url: `https://x.com/${handle}/status/${sid}`,
          handle,
          pub,
          titleHint: stripHtml(String(hit.title ?? ""), 200),
        });
        if (candidates.length >= source.maxItems) break;
      }
      if (candidates.length >= source.maxItems) break;
    }

    const oembedSettled = await Promise.allSettled(
      candidates.map(async (c): Promise<RawHarvestItem | null> => {
        const oeUrl = `https://publish.twitter.com/oembed?${new URLSearchParams({
          url: c.url,
          omit_script: "true",
          dnt: "true",
        }).toString()}`;
        const oeRes = await fetchWithTimeout(oeUrl, { headers }, Math.min(timeoutMs, 2500), fetchImpl);
        let text = "";
        if (oeRes) {
          try {
            const oe = (await oeRes.json()) as { html?: string };
            const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(oe.html ?? "");
            text = stripHtml(pMatch ? pMatch[1] : (oe.html ?? ""), 1200);
          } catch {
            text = "";
          }
        }
        const finalBody = text || c.titleHint;
        if (!finalBody || finalBody.length < 18) return null;
        if (!isRelevantForSource(source, finalBody, c.titleHint)) return null;
        const shortHeadline = finalBody.length > 105 ? `${finalBody.slice(0, 105).replace(/\s+\S*$/, "")}…` : finalBody;
        return {
          platformId: "x",
          category: "social",
          url: c.url,
          title: `@${c.handle}: ${shortHeadline}`,
          body: finalBody,
          publishedAt: c.pub,
          authorHandle: `@${c.handle}`,
          score: source.baseScore,
          region: "social",
        };
      }),
    );

    const items = oembedSettled
      .filter((r): r is PromiseFulfilledResult<RawHarvestItem | null> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value!);
    return { ok: true, items };
  }

  if (source.kind === "x_syndication") {
    const res = await fetchWithTimeout(
      source.url,
      { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" } },
      timeoutMs,
      fetchImpl,
    );
    if (!res) return { ok: false, items: [] };
    const htmlBody = await res.text();
    const m = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(htmlBody);
    if (!m?.[1]) return { ok: true, items: [] };
    try {
      const data = JSON.parse(m[1]) as {
        props?: { pageProps?: { timeline?: { entries?: Array<{ content?: { tweet?: Record<string, unknown> } }> } } };
      };
      const entries = data.props?.pageProps?.timeline?.entries ?? [];
      const fallbackHandle = source.url.split("/").pop() || "OpenAI";
      const out: RawHarvestItem[] = [];
      for (const entry of entries) {
        const tw = entry?.content?.tweet;
        if (!tw || tw.retweeted_status || tw.in_reply_to_status_id_str) continue;
        const sid = String(tw.id_str ?? tw.id ?? "").trim();
        const text = stripHtml(String(tw.full_text ?? tw.text ?? ""), 1200);
        if (!sid || text.length < 22 || BLOCKED_NOISE_RE.test(text)) continue;
        const user = (tw.user ?? {}) as Record<string, unknown>;
        const handle = String(user.screen_name ?? fallbackHandle).trim();
        const pub = normalizeTimestamp(typeof tw.created_at === "string" ? tw.created_at : null, now, "social");
        if (pub && Date.parse(pub) < cutoffMs) continue;
        const shortHeadline = text.length > 105 ? `${text.slice(0, 105).replace(/\s+\S*$/, "")}…` : text;
        out.push({
          platformId: "x",
          category: "social",
          url: `https://x.com/${handle}/status/${sid}`,
          title: `@${handle}: ${shortHeadline}`,
          body: text,
          publishedAt: pub,
          authorHandle: `@${handle}`,
          score: source.baseScore,
          region: "social",
        });
        if (out.length >= source.maxItems) break;
      }
      return { ok: true, items: out };
    } catch {
      return { ok: false, items: [] };
    }
  }

  return { ok: false, items: [] };
}

// ── 한국어 4단 요약 + 원본 쉽게 읽기 변환기 ────────────────────────────────────
function extractEntities(text: string, platformName: string, category: Category): Entity[] {
  const found: Entity[] = [];
  const seen = new Set<string>();
  for (const [name, kind, tags] of KNOWN_ENTITIES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, name.length >= 5 ? "i" : "");
    if (re.test(text)) {
      const k = name.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        found.push({ name, kind, tags: [...tags] });
      }
    }
    if (found.length >= 4) break;
  }
  if (found.length === 0) {
    const cleanPlat = platformName.replace(/\s*\([^)]*\)/g, "").trim() || platformName;
    found.push({ name: cleanPlat, kind: "platform", tags: [category.replace("_", "-")] });
  }
  return found;
}

function extractTerms(blob: string): Term[] {
  const low = blob.toLowerCase();
  const out: Term[] = [];
  for (const [term, easy] of KNOWN_TERMS) {
    if (low.includes(term.toLowerCase())) {
      out.push({ term, easy });
    }
    if (out.length >= 3) break;
  }
  return out;
}

function inferDifficulty(raw: RawHarvestItem): Difficulty {
  if (raw.category === "research" || raw.url.includes("arxiv.org")) return 3;
  if (raw.category === "dev" || raw.platformId === "hacker-news" || raw.platformId === "juejin") return 2;
  return 1;
}

function inferBenefitTag(raw: RawHarvestItem): string | null {
  const hay = `${raw.title} ${raw.body.slice(0, 300)}`.toLowerCase();
  if (/(open[- ]?source|open weights|apache 2\.0|mit license|오픈소스|开源)/i.test(hay)) return "오픈소스 공개 소식";
  if (/(free tier|free to use|무료 공개|무료 배포|免费)/i.test(hay)) return "무료 활용 가능";
  if (/show hn/i.test(raw.title)) return "개발자 신규 런칭";
  return null;
}

function buildKoreanFallbackHeadline(
  originalTitle: string,
  platformName: string,
  category: Category,
  entities: Entity[],
  authorHandle?: string | null,
): string {
  const cleanOrig = originalTitle.replace(/[\u4e00-\u9fff\u3040-\u30ff]+/g, " ").replace(/\s+/g, " ").trim();
  const keySubject = entities[0]?.name || platformName;
  const catLabel = CATEGORY_LABELS[category] ?? "AI";
  if (authorHandle) {
    return `${authorHandle} 실시간 공유: ${keySubject} 관련 ${catLabel} 신규 업데이트`;
  }
  if (cleanOrig.length >= 8 && !containsUntranslatedCjk(cleanOrig)) {
    const trimmed = cleanOrig.length > 62 ? `${cleanOrig.slice(0, 62).replace(/\s+\S*$/, "")}…` : cleanOrig;
    return `${keySubject} 최신 소식: ${trimmed}`;
  }
  return `${platformName} 실시간 ${catLabel} 속보 · ${keySubject} 주요 업데이트`;
}

function languageCaveat(region: string, translated: boolean): string {
  if (region === "kr") {
    return "한국어 원문 실시간 소식이에요. 세부 맥락과 도표·코드 예시는 원문 링크에서 바로 확인할 수 있어요.";
  }
  if (region === "cn") {
    return translated
      ? "중국어 원문을 한국어로 자동 번역·정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요."
      : "중국어 원문 속보를 핵심 위주로 정리했어요. 세부 수치와 원문 표현은 원문 링크에서 확인하세요.";
  }
  return translated
    ? "영문 원문을 한국어로 자동 번역·정리했어요. 세부 수치·벤치마크 조건과 전체 맥락은 원문 링크에서 확인하세요."
    : "영문 원문 속보의 핵심 요지를 정리했어요. 세부 수치·벤치마크 조건과 전체 맥락은 원문 링크에서 확인하세요.";
}

async function convertRawToLiveFeedItem(
  raw: RawHarvestItem,
  nowIso: string,
  translate: (text: string) => Promise<string | null>,
): Promise<LiveFeedWireItem | null> {
  const platform = PLATFORMS_BY_ID.get(raw.platformId);
  if (!platform || !isValidHttpsUrl(raw.url)) return null;

  const platformName = platform.name;
  const catLabel = CATEGORY_LABELS[raw.category] ?? "AI";
  const originalTitle = sanitizeKoreanCopy(raw.title);
  if (!originalTitle) return null;

  const entities = extractEntities(`${originalTitle} ${raw.body.slice(0, 800)}`, platformName, raw.category);
  const titleNeedsTr = needsKoreanTranslation(originalTitle);
  const bodySnippet = raw.body.replace(URL_IN_TEXT_RE, "").replace(/\s+/g, " ").trim().slice(0, 480);
  const bodyNeedsTr = Boolean(bodySnippet) && needsKoreanTranslation(bodySnippet);

  const [trTitleRes, trBodyRes] = await Promise.all([
    titleNeedsTr ? translate(originalTitle).catch(() => null) : Promise.resolve(originalTitle),
    bodyNeedsTr ? translate(bodySnippet).catch(() => null) : Promise.resolve(bodySnippet),
  ]);

  let titleKo = sanitizeKoreanCopy(trTitleRes || "");
  const translated = Boolean(
    (titleNeedsTr && titleKo && !needsKoreanTranslation(titleKo)) ||
      (bodyNeedsTr && trBodyRes && !needsKoreanTranslation(trBodyRes)),
  );

  // 한국어 제목 보장: 번역 실패·미번역 잔존 시에도 자연스러운 한국어 헤드라인으로 보정
  if (!titleKo || containsUntranslatedCjk(titleKo) || (titleNeedsTr && !/[가-힣]/.test(titleKo))) {
    titleKo = buildKoreanFallbackHeadline(originalTitle, platformName, raw.category, entities, raw.authorHandle);
  }

  let bodyKo = sanitizeKoreanCopy(trBodyRes || "");
  if (bodyKo && (containsUntranslatedCjk(bodyKo) || needsKoreanTranslation(bodyKo))) {
    bodyKo = "";
  }

  const benefitTag = inferBenefitTag(raw);
  const contextKo = raw.authorHandle
    ? `X(트위터) ${raw.authorHandle} 계정의 실시간 AI 포스트를 바로 포착했어요.`
    : `${platformName}에서 방금 올라온 ${catLabel} 분야 실시간 소식이에요.`;
  const whatKo =
    bodyKo.length >= 28
      ? bodyKo
      : `${platformName}에서 '${titleKo}' 소식을 공개했어요. ${entities[0]?.name ?? platformName} 관련 최신 기능·업데이트 요지를 빠르게 확인할 수 있어요.`;
  const whyKo = CATEGORY_WHY[raw.category] ?? CATEGORY_WHY.industry;
  const caveatsKo = languageCaveat(raw.region, translated);
  const difficulty = inferDifficulty(raw);
  const terms = extractTerms(`${titleKo} ${contextKo} ${whatKo} ${whyKo}`);

  const normUrl = normalizeUrlForDedup(raw.url);
  const id = `live-edge-${createHash("sha256").update(normUrl).digest("hex").slice(0, 12)}`;
  const publishedAt = raw.publishedAt;
  const createdAt = publishedAt ?? nowIso;

  const baseItem: FeedItem = {
    id,
    platform_id: raw.platformId,
    category: raw.category,
    canonical_url: raw.url,
    thumbnail_url: raw.thumbnailUrl && isValidHttpsUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : null,
    importance_score: Math.round(raw.score * 100) / 100,
    source_count: 1,
    source_platforms: [raw.platformId],
    author_handle: raw.authorHandle ?? null,
    lifecycle_status: "hot",
    published_at: publishedAt,
    fetched_at: nowIso,
    created_at: createdAt,
    original_title: originalTitle,
    title_ko: titleKo,
    hook_title: titleKo,
    benefit_tag: benefitTag,
    context_ko: contextKo,
    what_ko: whatKo,
    analogy_ko: null,
    why_ko: whyKo,
    caveats_ko: caveatsKo,
    highlight_summary: null,
    utility_tip: null,
    planning_meta: null,
    difficulty,
    terms,
    entities,
    easy_original_ready: true,
  };

  baseItem.highlight_summary = getHighlightSummary(baseItem);
  baseItem.utility_tip = getUtilityInsight(baseItem, platformName);
  baseItem.planning_meta = getPlanningMeta(baseItem, platformName);

  const easyOriginal = synthesizeEasyOriginal(baseItem, nowIso);

  if (liveEdgeItemMemo.size >= MAX_LIVE_EDGE_MEMO) {
    const firstKey = liveEdgeItemMemo.keys().next().value;
    if (firstKey !== undefined) liveEdgeItemMemo.delete(firstKey);
  }
  liveEdgeItemMemo.set(id, { item: baseItem, easy: easyOriginal });

  return {
    ...baseItem,
    easy_original: easyOriginal,
  };
}

// ── 순수 최신 시각(published_at 내림차순) 최우선 정렬 ───────────────────────────
function chronoKey(item: FeedItem, nowMs: number): [number, number, number] {
  const rawIso = item.published_at ?? item.created_at;
  const parsed = rawIso ? Date.parse(rawIso) : Number.NaN;
  if (!Number.isNaN(parsed) && parsed <= nowMs + FUTURE_TOLERANCE_MS) {
    const effectiveTs = Math.min(parsed, nowMs);
    const ageH = Math.max(0, (nowMs - effectiveTs) / 3_600_000);
    const tier = ageH <= HOT_FRESH_CUTOFF_HOURS ? 2 : 1;
    return [tier, effectiveTs, Number(item.importance_score) || 0];
  }
  const fallbackTs = Date.parse(item.fetched_at ?? item.created_at) || 0;
  return [0, Math.min(fallbackTs, nowMs), Number(item.importance_score) || 0];
}

export function mergeAndSortLiveFeed(
  snapshot: LiveSnapshot,
  deltaItems: LiveFeedWireItem[],
  now: Date,
): { items: LiveFeedWireItem[]; addedCount: number } {
  const nowMs = now.getTime();
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const seenIds = new Set<string>();

  const snapshotWire: LiveFeedWireItem[] = snapshot.items.map((item) => {
    const easy = snapshot.easyOriginals[item.id];
    return easy ? { ...item, easy_original: easy } : { ...item };
  });

  // 기존 스냅샷의 URL·정규화 제목 인덱스 구축 (기존 심층 요약본 우선 보존)
  for (const item of snapshotWire) {
    seenIds.add(item.id);
    seenUrls.add(normalizeUrlForDedup(item.canonical_url));
    const t1 = normalizeTitleForDedup(item.original_title ?? "");
    const t2 = normalizeTitleForDedup(item.hook_title);
    if (t1.length >= 8) seenTitles.add(t1);
    if (t2.length >= 8) seenTitles.add(t2);
  }

  const freshAdditions: LiveFeedWireItem[] = [];
  for (const item of deltaItems) {
    const normUrl = normalizeUrlForDedup(item.canonical_url);
    const tOrig = normalizeTitleForDedup(item.original_title ?? "");
    const tHook = normalizeTitleForDedup(item.hook_title);
    if (seenIds.has(item.id) || seenUrls.has(normUrl)) continue;
    if ((tOrig.length >= 8 && seenTitles.has(tOrig)) || (tHook.length >= 8 && seenTitles.has(tHook))) continue;
    seenIds.add(item.id);
    seenUrls.add(normUrl);
    if (tOrig.length >= 8) seenTitles.add(tOrig);
    if (tHook.length >= 8) seenTitles.add(tHook);
    freshAdditions.push(item);
  }

  const all = [...freshAdditions, ...snapshotWire];
  const hotPool = all.filter((i) => i.lifecycle_status === "hot");
  const warmPool = all.filter((i) => i.lifecycle_status === "warm");

  hotPool.sort((a, b) => {
    const ka = chronoKey(a, nowMs);
    const kb = chronoKey(b, nowMs);
    return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
  });
  warmPool.sort((a, b) => b.importance_score - a.importance_score);

  const hotCap = warmPool.length > 0 ? Math.min(MAX_FEED_ITEMS, MAX_HOT_ITEMS) : MAX_FEED_ITEMS;
  const selectedHot = hotPool.slice(0, hotCap);
  const warmCap = Math.min(MAX_WARM_ITEMS, Math.max(0, MAX_FEED_ITEMS - selectedHot.length));
  const selectedWarm = warmPool.slice(0, warmCap);

  return {
    items: [...selectedHot, ...selectedWarm],
    addedCount: freshAdditions.length,
  };
}

// ── 메인 엔트리: 베이스 스냅샷 로드 + 병렬 실시간 델타 수집 + 병합 ───────────────
export async function buildLiveFeedPayload(deps: LiveFeedDeps = {}): Promise<LiveFeedApiPayload> {
  const now = deps.now ?? new Date();
  const bypassCache = Boolean(deps.bypassCache || deps.fetchImpl || deps.loadSnapshot || deps.sources || deps.translateFn);

  if (!bypassCache && cachedResponse && cachedResponse.expiresAt > now.getTime()) {
    return cachedResponse.payload;
  }
  if (!bypassCache && inflightBuild) {
    return inflightBuild;
  }

  const run = async (): Promise<LiveFeedApiPayload> => {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const sources = deps.sources ?? LIVE_HARVEST_SOURCES;
    const sourceTimeoutMs = deps.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
    const translateTimeoutMs = deps.translateTimeoutMs ?? DEFAULT_TRANSLATE_TIMEOUT_MS;
    const translate = deps.translateFn ?? ((txt: string) => translateToKorean(txt, fetchImpl, translateTimeoutMs));

    // 1) 베이스 스냅샷(GitHub Raw 우선 → 로컬 public/live-feed.json 폴백) + 실시간 속보 창구 병렬 동시 가동
    const snapshotPromise = (deps.loadSnapshot ?? (() => loadLiveSnapshotAsync()))().catch(() => loadLiveSnapshot());
    const harvestPromises = Promise.allSettled(
      sources.map((src) => fetchOneSource(src, now, sourceTimeoutMs, fetchImpl)),
    );

    const [snapshot, settledHarvest] = await Promise.all([snapshotPromise, harvestPromises]);

    // 2) 스냅샷 기준 중복 URL/제목 집합 미리 계산 (이미 있는 글은 번역 호출 0회로 즉시 스킵)
    const existingUrls = new Set<string>();
    const existingTitles = new Set<string>();
    for (const item of snapshot.items) {
      existingUrls.add(normalizeUrlForDedup(item.canonical_url));
      const t1 = normalizeTitleForDedup(item.original_title ?? "");
      const t2 = normalizeTitleForDedup(item.hook_title);
      if (t1.length >= 8) existingTitles.add(t1);
      if (t2.length >= 8) existingTitles.add(t2);
    }

    const rawCandidates: RawHarvestItem[] = [];
    const seenDeltaUrls = new Set<string>();
    const seenDeltaTitles = new Set<string>();
    let okSourceCount = 0;

    for (const res of settledHarvest) {
      if (res.status !== "fulfilled") continue;
      if (res.value.ok) okSourceCount += 1;
      for (const raw of res.value.items) {
        const normUrl = normalizeUrlForDedup(raw.url);
        const normTitle = normalizeTitleForDedup(raw.title);
        if (existingUrls.has(normUrl) || seenDeltaUrls.has(normUrl)) continue;
        if (normTitle.length >= 8 && (existingTitles.has(normTitle) || seenDeltaTitles.has(normTitle))) continue;
        seenDeltaUrls.add(normUrl);
        if (normTitle.length >= 8) seenDeltaTitles.add(normTitle);
        rawCandidates.push(raw);
      }
    }

    // 가장 최신 글 우선으로 상한(18건) 선정 후 병렬 번역·구조화
    rawCandidates.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta || b.score - a.score;
    });

    const nowIso = now.toISOString();
    const topNew = rawCandidates.slice(0, MAX_NEW_ITEMS_PER_CYCLE);
    const convertedSettled = await Promise.allSettled(
      topNew.map((raw) => convertRawToLiveFeedItem(raw, nowIso, translate)),
    );
    const deltaItems = convertedSettled
      .filter((r): r is PromiseFulfilledResult<LiveFeedWireItem | null> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value!);

    const { items, addedCount } = mergeAndSortLiveFeed(snapshot, deltaItems, now);

    // 실시간 라이브 보강이 1개 이상 소스에서 정상 응답했으면 현재 체크 시각(nowIso)을 최신 수집 시각으로 반영
    const generatedAt = addedCount > 0 || okSourceCount > 0 ? nowIso : snapshot.generatedAt ?? nowIso;

    const payload: LiveFeedApiPayload = {
      version: 1,
      generated_at: generatedAt,
      snapshot_generated_at: snapshot.generatedAt,
      harvested_at: nowIso,
      live_added_count: addedCount,
      item_count: items.length,
      items,
    };

    if (!bypassCache) {
      cachedResponse = { expiresAt: now.getTime() + RESPONSE_CACHE_TTL_MS, payload };
    }
    return payload;
  };

  if (bypassCache) return run();
  inflightBuild = run().finally(() => {
    inflightBuild = null;
  });
  return inflightBuild;
}
