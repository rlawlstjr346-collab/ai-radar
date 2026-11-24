import type { FeedItem, Platform } from "./types";

/** 다중 매체 동일 이슈 클러스터링 시간 창 (36시간) */
export const CLUSTER_WINDOW_HOURS = 36;
export const CLUSTER_WINDOW_MS = CLUSTER_WINDOW_HOURS * 3_600_000;

/** 출처 공신력 티어 (대표 카드 선정용) */
const SOURCE_AUTHORITY: Record<string, number> = {
  // Tier 1: 프론티어 공식 연구소·모델사
  openai: 32,
  anthropic: 32,
  "google-deepmind": 32,
  "meta-ai": 30,
  deepseek: 30,
  qwen: 30,
  mistral: 30,
  nvidia: 30,
  xai: 30,
  "apple-ml": 30,
  "microsoft-research": 30,
  "aws-ml": 28,
  huggingface: 28,
  // Tier 2: 주요 글로벌·국내·중국 AI 전문 미디어 & 뉴스레터
  "the-verge-ai": 24,
  "techcrunch-ai": 24,
  "ars-technica": 23,
  wired: 23,
  "mit-tr": 24,
  "mit-tr-korea": 24,
  aitimes: 23,
  "36kr-ai": 22,
  qbitai: 22,
  "simon-willison": 23,
  "latent-space": 22,
  "import-ai": 22,
  "ahead-of-ai": 22,
  interconnects: 21,
  "one-useful-thing": 21,
  "itmedia-aiplus": 20,
  "toss-tech": 21,
  // Tier 3: 개발자·큐레이션 플랫폼
  github: 17,
  "hacker-news": 16,
  geeknews: 16,
  gpters: 15,
  "pytorch-kr": 16,
  qiita: 14,
  "hatena-bookmark": 13,
  // Tier 4: 소셜·커뮤니티 단문
  x: 10,
  bluesky: 10,
  v2ex: 10,
  juejin: 11,
};

const OFFICIAL_X_HANDLES = new Set([
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

/** 단순 일반어·불용어 — 이 단어들만 겹쳐서는 절대로 클러스터링하지 않는다 */
const STOPWORDS = new Set([
  // 한국어 일반 AI/뉴스 불용어
  "ai",
  "인공지능",
  "모델",
  "대형",
  "대규모",
  "언어",
  "출시",
  "공개",
  "발표",
  "오픈",
  "오픈소스",
  "개발",
  "에이전트",
  "신규",
  "최신",
  "업데이트",
  "기능",
  "서비스",
  "기업",
  "회사",
  "기술",
  "연구",
  "논문",
  "플랫폼",
  "도구",
  "사용",
  "기반",
  "지원",
  "버전",
  "정식",
  "프리뷰",
  "베타",
  "무료",
  "유료",
  "성능",
  "향상",
  "강화",
  "국내",
  "해외",
  "글로벌",
  "실시간",
  "관련",
  "속보",
  "소식",
  "뉴스",
  "가이드",
  "방법",
  "정리",
  "핵심",
  "요약",
  "소개",
  "선보입니다",
  "선보인다",
  "공개했습니다",
  "공개했다",
  "출시했습니다",
  "출시했다",
  "발표했습니다",
  "발표했다",
  "공식",
  "공식적으로",
  "새로운",
  "위한",
  "통해",
  "대한",
  "에서",
  "하는",
  "있는",
  "되는",
  "이번",
  "오늘",
  "최근",
  "프로젝트",
  "시스템",
  "애플리케이션",
  "웹앱",
  "코딩",
  "프로그래밍",
  "워크플로",
  "데이터",
  "학습",
  "추론",
  "벤치마크",
  "생성",
  "생성형",
  "챗봇",
  "생산성",
  "빅테크",
  "트렌드",
  "커뮤니티",
  "화제",
  "우리",
  "사람",
  "가장",
  "함께",
  "직접",
  "활용",
  "구축",
  "제작",
  "만들어",
  "만들기",
  // 영어 일반 AI/뉴스 불용어
  "model",
  "models",
  "llm",
  "llms",
  "release",
  "released",
  "releases",
  "releasing",
  "launch",
  "launched",
  "launches",
  "launching",
  "open",
  "source",
  "opensource",
  "weights",
  "agent",
  "agents",
  "agentic",
  "new",
  "latest",
  "update",
  "updates",
  "updated",
  "announce",
  "announces",
  "announced",
  "announcing",
  "introduce",
  "introduces",
  "introduced",
  "introducing",
  "unveil",
  "unveils",
  "unveiled",
  "ship",
  "ships",
  "shipped",
  "shipping",
  "using",
  "used",
  "use",
  "build",
  "builds",
  "built",
  "building",
  "make",
  "makes",
  "made",
  "making",
  "tool",
  "tools",
  "system",
  "systems",
  "platform",
  "app",
  "apps",
  "api",
  "sdk",
  "cli",
  "code",
  "coding",
  "artificial",
  "intelligence",
  "machine",
  "learning",
  "deep",
  "paper",
  "research",
  "benchmark",
  "benchmarks",
  "report",
  "guide",
  "news",
  "post",
  "thread",
  "today",
  "now",
  "here",
  "how",
  "why",
  "what",
  "when",
  "where",
  "who",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "for",
  "the",
  "and",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "into",
  "over",
  "under",
  "more",
  "most",
  "very",
  "just",
  "about",
  "your",
  "our",
  "their",
  "they",
  "them",
  "will",
  "would",
  "could",
  "should",
  "can",
  "not",
  "but",
  "all",
  "one",
  "two",
  "three",
  "first",
  "second",
  "next",
  "best",
  "better",
  "free",
  "fast",
  "faster",
  "full",
  "real",
  "realtime",
  "time",
  "via",
  "show",
  "ask",
  "ainews",
  "preview",
  "beta",
  "alpha",
  "version",
  "official",
  "officially",
  "public",
  "available",
  "support",
  "supports",
  "powered",
  "based",
  "local",
  "native",
  "runtime",
  "engine",
  "framework",
  "library",
  "workflow",
  "workflows",
  "data",
  "training",
  "inference",
  "reasoning",
  "frontier",
  "enterprise",
  "developer",
  "developers",
  "feature",
  "features",
  "review",
  "study",
  "work",
  "working",
  "world",
  "global",
  "large",
  "small",
  "high",
  "performance",
  "speed",
  "cost",
  "price",
  "pricing",
  "help",
  "helps",
  "allowing",
  "allows",
  "without",
  "through",
  "across",
  "between",
  "after",
  "before",
  "during",
  "while",
  "since",
  "also",
  "still",
  "even",
  "only",
  "its",
  "you",
  "your",
  "we",
  "they",
  "their",
  "out",
  "off",
  "top",
  "big",
  "way",
  "day",
  "year",
  "2025",
  "2026",
  "2027",
  // 중국어/일본어 일반어
  "开源",
  "发布",
  "正式",
  "模型",
  "大模型",
  "智能体",
  "人工智能",
  "最新",
  "公开",
  "推出",
  "上线",
  "工具",
  "平台",
  "系统",
  "技术",
  "开发",
  "生成",
]);

/** 회사·광범위 제품군 이름 — 단독 일치만으로는 다른 기사를 묶지 않는다 */
const BROAD_BRAND_TOKENS = new Set([
  "openai",
  "anthropic",
  "google",
  "deepmind",
  "meta",
  "microsoft",
  "apple",
  "amazon",
  "aws",
  "nvidia",
  "cisco",
  "baidu",
  "alibaba",
  "tencent",
  "bytedance",
  "zhipu",
  "moonshot",
  "xai",
  "mistral",
  "huggingface",
  "github",
  "claude",
  "gemini",
  "chatgpt",
  "gpt",
  "deepseek",
  "qwen",
  "llama",
  "grok",
  "kimi",
  "glm",
  "wenxin",
  "vllm",
  "ollama",
  "comfyui",
  "cursor",
  "windsurf",
  "codex",
  "sora",
  "veo",
  "kling",
  "flux",
  "midjourney",
  "perplexity",
  "notebooklm",
  "temporal",
  "linux",
  "python",
  "swift",
  "swiftui",
  "macos",
  "windows",
  "android",
  "chrome",
  "vercel",
  "cloudflare",
  "bedrock",
  "jensen",
  "huang",
  "turing",
  "cambridge",
]);

/** 고유 제품명 추출 시 제외할 일반 영어 단어 (첫 글자 대문자 문장 시작 등) */
const COMMON_TITLE_WORDS = new Set([
  ...STOPWORDS,
  ...BROAD_BRAND_TOKENS,
  "introducing",
  "announcing",
  "launching",
  "releasing",
  "building",
  "creating",
  "making",
  "writing",
  "reading",
  "thinking",
  "understanding",
  "exploring",
  "comparing",
  "measuring",
  "testing",
  "running",
  "deploying",
  "scaling",
  "improving",
  "expanding",
  "bringing",
  "starting",
  "ending",
  "changing",
  "moving",
  "turning",
  "finding",
  "getting",
  "taking",
  "giving",
  "keeping",
  "holding",
  "coming",
  "going",
  "looking",
  "seeing",
  "knowing",
  "wanting",
  "needing",
  "trying",
  "putting",
  "setting",
  "calling",
  "asking",
  "telling",
  "saying",
  "talking",
  "playing",
  "living",
  "feeling",
  "seeming",
  "leaving",
  "staying",
  "waiting",
  "serving",
  "sending",
  "paying",
  "meeting",
  "including",
  "continuing",
  "learning",
  "teaching",
  "leading",
  "watching",
  "following",
  "stopping",
  "winning",
  "losing",
  "cutting",
  "breaking",
  "growing",
  "opening",
  "closing",
  "sharing",
  "defending",
  "protecting",
  "controlling",
  "managing",
  "handling",
  "solving",
  "fixing",
  "checking",
  "verify",
  "verification",
  "formal",
  "quantum",
  "computers",
  "computer",
  "computing",
  "fusion",
  "energy",
  "chemistry",
  "biology",
  "physics",
  "science",
  "scientific",
  "medical",
  "clinical",
  "legal",
  "finance",
  "financial",
  "market",
  "markets",
  "economy",
  "economic",
  "economics",
  "business",
  "businesses",
  "company",
  "companies",
  "startup",
  "startups",
  "industry",
  "government",
  "policy",
  "safety",
  "security",
  "privacy",
  "trust",
  "trusted",
  "access",
  "control",
  "controls",
  "safeguards",
  "connected",
  "interactive",
  "archive",
  "archival",
  "photos",
  "video",
  "audio",
  "voice",
  "image",
  "images",
  "music",
  "sound",
  "speech",
  "vision",
  "text",
  "language",
  "languages",
  "multimodal",
  "context",
  "memory",
  "search",
  "browser",
  "cloud",
  "server",
  "client",
  "hardware",
  "software",
  "device",
  "devices",
  "mobile",
  "desktop",
  "laptop",
  "chip",
  "chips",
  "silicon",
  "neural",
  "network",
  "networks",
  "transformer",
  "transformers",
  "diffusion",
  "attention",
  "embedding",
  "embeddings",
  "positional",
  "token",
  "tokens",
  "prompt",
  "prompts",
  "dataset",
  "datasets",
  "parameter",
  "parameters",
  "weights",
  "adapter",
  "adapters",
  "plugin",
  "plugins",
  "extension",
  "extensions",
  "package",
  "packages",
  "library",
  "libraries",
  "module",
  "modules",
  "kernel",
  "kernels",
  "compiler",
  "debugger",
  "sandbox",
  "container",
  "cluster",
  "clusters",
  "infrastructure",
  "architecture",
  "pipeline",
  "pipelines",
  "provider",
  "providers",
  "incident",
  "incidents",
  "processing",
  "program",
  "programs",
  "project",
  "projects",
  "product",
  "products",
  "service",
  "services",
  "solution",
  "solutions",
  "expert",
  "experts",
  "team",
  "teams",
  "human",
  "humans",
  "people",
  "person",
  "users",
  "user",
  "customer",
  "customers",
  "partner",
  "partners",
  "partnership",
  "funding",
  "billion",
  "million",
  "trillion",
  "history",
  "future",
  "modern",
  "yesterday",
  "tomorrow",
  "morning",
  "evening",
  "night",
  "week",
  "month",
  "quarter",
  "annual",
  "daily",
  "weekly",
  "monthly",
  "podcast",
  "interview",
  "edition",
  "issue",
  "series",
  "chapter",
  "section",
  "summary",
  "overview",
  "analysis",
  "insights",
  "trends",
  "update",
  "notes",
  "changelog",
  "release",
  "paper",
  "blog",
  "article",
  "story",
  "stories",
  "china",
  "chinese",
  "korea",
  "korean",
  "japan",
  "japanese",
  "america",
  "american",
  "europe",
  "european",
  "united",
  "states",
  "stanford",
  "harvard",
  "oxford",
  "berkeley",
  "mit",
  "seoul",
  "tokyo",
  "beijing",
  "shanghai",
  "london",
  "paris",
  "flash",
  "ultra",
  "turbo",
  "mini",
  "nano",
  "micro",
  "mega",
  "super",
  "hyper",
  "plus",
  "pro",
  "max",
  "lite",
  "core",
  "base",
  "tiny",
  "large",
  "small",
  "medium",
  "open",
  "closed",
  "free",
  "paid",
  "private",
  "public",
  "general",
  "special",
  "custom",
  "standard",
  "advanced",
  "basic",
  "simple",
  "complex",
  "smart",
  "clever",
  "quiet",
  "clean",
  "fresh",
  "pure",
  "true",
  "real",
  "virtual",
  "digital",
  "cyber",
  "space",
  "conscious",
  "mythology",
  "jagged",
  "slop",
  "weapon",
  "emerging",
  "proposed",
  "initial",
  "offering",
  "roadshow",
  "files",
  "completes",
  "largest",
  "valued",
  "downtime",
  "defend",
  "recreated",
  "pretraining",
  "curve",
  "joined",
  "back",
  "return",
  "returns",
  "returned",
  "surge",
  "surges",
  "stock",
  "shares",
  "price",
  "bill",
  "expensive",
  "order",
  "orders",
  "purchase",
  "invoice",
  "screen",
  "recording",
  "recorder",
  "watermark",
  "login",
  "offline",
  "online",
  "website",
  "websites",
  "boring",
  "bored",
  "funny",
  "interesting",
  "collection",
  "design",
  "designer",
  "interface",
  "surface",
  "brain",
  "computer",
  "glasses",
  "assistant",
  "employee",
  "employees",
  "overtime",
  "probe",
  "monitor",
  "monitoring",
  "hardware",
  "disk",
  "space",
  "uninstall",
  "menu",
  "menubar",
  "charts",
  "chart",
  "table",
  "tables",
  "map",
  "maps",
  "food",
  "game",
  "games",
  "gaming",
  "player",
  "gamer",
  "exam",
  "exams",
  "answer",
  "answers",
  "traffic",
  "telemetry",
  "reverse",
  "engineering",
  "contract",
  "programming",
  "strategy",
  "media",
  "owned",
  "draft",
  "site",
  "improvement",
  "self",
  "improvement",
  "everything",
  "anything",
  "something",
  "nothing",
  "everyone",
  "anyone",
  "someone",
  "nobody",
  "another",
  "other",
  "others",
  "every",
  "neither",
  "either",
  "different",
  "similar",
  "same",
  "equal",
  "single",
  "double",
  "triple",
  "multiple",
  "various",
  "several",
  "certain",
  "specific",
  "particular",
  "major",
  "minor",
  "primary",
  "secondary",
  "critical",
  "important",
  "significant",
  "notable",
  "remarkable",
  "amazing",
  "surprising",
  "sudden",
  "prevalence",
  "learned",
  "gates",
  "looped",
  "neat",
  "actual",
  "cool",
  "thing",
  "things",
  "point",
  "points",
  "level",
  "levels",
  "stage",
  "phase",
  "step",
  "steps",
  "part",
  "parts",
  "case",
  "cases",
  "form",
  "forms",
  "type",
  "types",
  "kind",
  "kinds",
  "ways",
  "needs",
  "turn",
  "turns",
  "sound",
  "power",
  "skills",
  "world",
  "house",
  "inhouse",
  "github",
  "huggingface",
  "reddit",
  "twitter",
  "youtube",
  "substack",
  "medium",
  "hacker",
  "verge",
  "techcrunch",
  "venturebeat",
  "reuters",
  "bloomberg",
  "nytimes",
  "wsj",
  "wired",
  "arxiv",
  "nature",
  "science",
]);

/** 다국어 별칭 → 정규화 표준 키 치환 */
const ALIAS_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/文心(?:一言)?|문심(?:일언)?|\bernie\b/gi, " wenxin "],
  [/通义千问|통의천문|큐원/gi, " qwen "],
  [/深度求索|딥시크/gi, " deepseek "],
  [/智谱(?:清言|AI)?|즈푸(?:AI)?/gi, " zhipu "],
  [/月之暗面|문샷/gi, " moonshot "],
  [/오픈\s*ai|오픈에이아이/gi, " openai "],
  [/앤트로픽|앤스로픽/gi, " anthropic "],
  [/구글\s*딥마인드|딥마인드/gi, " deepmind "],
  [/구글|谷歌/gi, " google "],
  [/제미나이|제미니/gi, " gemini "],
  [/클로드/gi, " claude "],
  [/챗지피티|챗gpt/gi, " chatgpt "],
  [/지피티제로|gpt제로/gi, " gptzero "],
  [/지피티/gi, " gpt "],
  [/엔비디아|英伟达/gi, " nvidia "],
  [/마이크로소프트|微软/gi, " microsoft "],
  [/애플(?!\s*뉴스)/gi, " apple "],
  [/바이두|百度/gi, " baidu "],
  [/알리바바|阿里(?:巴巴)?/gi, " alibaba "],
  [/텐센트|腾讯/gi, " tencent "],
  [/메타/gi, " meta "],
  [/라마/gi, " llama "],
  [/미스트랄/gi, " mistral "],
  [/키미/gi, " kimi "],
  [/그록/gi, " grok "],
  [/페이블/gi, " fable "],
  [/오퍼스/gi, " opus "],
  [/소넷/gi, " sonnet "],
  [/하이쿠/gi, " haiku "],
  [/소라/gi, " sora "],
  [/비오/gi, " veo "],
  [/클링/gi, " kling "],
  [/지니/gi, " genie "],
  [/시스코/gi, " cisco "],
  [/젠슨\s*황|황런쉰|黄仁勋/gi, " jensen huang "],
];

/** 특정 제품·모델 + 버전 시그니처 패턴 (높은 정밀도) */
const VERSIONED_PRODUCT_RE =
  /\b(gptzero|chatgpt|gpt|wenxin|claude[-\s]+code|claude[-\s]+opus|claude[-\s]+sonnet|claude[-\s]+haiku|claude|opus|sonnet|haiku|gemini|deepseek|qwen|glm|kimi|llama|mistral|grok|vllm|ollama|comfyui|sora|veo|kling|genie|fable|flux|midjourney|longcat|depthpro|inkling|litellm|codex|cursor|windsurf|datasette-[a-z0-9-]+|ai-sdk)[-\s]*v?(\d+(?:\.\d+){0,2}(?:[a-z]\d+)?|[rvk]\d+(?:\.\d+)?)(?:[-\s]*(flash|preview|mini|nano|pro|ultra|turbo|max|plus|neon|carbon|argon|sol|astra|exp|sonnet|opus|haiku|code|r\d+|v\d+))?/gi;

/** 복합 고유명사 제품 시그니처 (버전 없이도 고유성이 높은 제품명) */
const COMPOUND_PRODUCT_RE =
  /\b(claude\s+ship|claude\s+code|gemini\s+(?:neon|carbon|argon)|gpt\s+codex|amazon\s+bedrock\s+trusted\s+access|apple\s+intelligence|openai\s+openworks|ant\s+oceanlake|oceanbase\s+oceanlake)\b/gi;

const REPO_URL_RE =
  /https?:\/\/(?:www\.)?(?:github\.com|huggingface\.co)\/([a-z0-9_.-]+\/[a-z0-9_.-]+)/gi;
const EXPLICIT_REPO_RE = /\b([a-z0-9][a-z0-9_.-]{1,38}\/[a-z0-9][a-z0-9_.-]{2,48})\b/gi;

const KO_PARTICLE_RE = /(?:에서|으로|에게|까지|부터|처럼|보다|라고|으로|은|는|이|가|을|를|의|에|로|와|과|도|만)$/;

export interface StoryProfile {
  item: FeedItem;
  timestampMs: number;
  normUrl: string;
  repoKeys: Set<string>;
  /** 예: "wenxin:5.5", "gpt:6.2", "vllm:0.34" */
  versionedKeys: Set<string>;
  /** 제품군별 핵심 버전(major.minor) — 서로 다른 버전 간 오병합 방지용 */
  familyVersions: Map<string, Set<string>>;
  /** 고유 제품명·코드네임 (회사명·일반어 제외, 예: "shirudo", "openworks", "claude-ship") */
  distinctiveNames: Set<string>;
  /** 브랜드·플랫폼·모델 패밀리 엔티티 */
  brandEntities: Set<string>;
  /** 불용어 제거 핵심 주제 토큰 */
  topicTokens: Set<string>;
  /** 핵심 주제 바이그램 */
  topicBigrams: Set<string>;
}

export function normalizeUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      const lk = k.toLowerCase();
      if (lk.startsWith("utm_") || lk === "ref" || lk === "source" || lk === "fbclid" || lk === "gclid") {
        drop.push(k);
      }
    });
    for (const k of drop) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function itemTimestampMs(item: Pick<FeedItem, "published_at" | "created_at">): number {
  const raw = item.published_at ?? item.created_at;
  const ms = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isNaN(ms)) return ms;
  const fallback = Date.parse(item.created_at);
  return Number.isNaN(fallback) ? 0 : fallback;
}

function normalizeAliases(text: string): string {
  let out = text;
  for (const [re, rep] of ALIAS_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}

function canonicalFamily(rawFamily: string): string {
  const f = rawFamily.toLowerCase().replace(/\s+/g, "-").trim();
  if (f === "claude-opus" || f === "opus") return "claude-opus";
  if (f === "claude-sonnet" || f === "sonnet") return "claude-sonnet";
  if (f === "claude-haiku" || f === "haiku") return "claude-haiku";
  return f;
}

function normalizeMajorMinor(ver: string): string {
  const low = ver.toLowerCase().replace(/^v/, "");
  const m = /^([rk]?\d+(?:\.\d+)?)/.exec(low);
  return m ? m[1] : low;
}

function stripKoParticle(tok: string): string {
  if (!/[가-힣]/.test(tok) || tok.length <= 2) return tok;
  const stripped = tok.replace(KO_PARTICLE_RE, "");
  return stripped.length >= 2 ? stripped : tok;
}

function buildBigrams(orderedTokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < orderedTokens.length - 1; i++) {
    out.add(`${orderedTokens[i]}|${orderedTokens[i + 1]}`);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) {
    if (big.has(x)) inter += 1;
  }
  if (inter === 0) return 0;
  return inter / (a.size + b.size - inter);
}

function intersectionCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) {
    if (big.has(x)) n += 1;
  }
  return n;
}

/**
 * 기사 1건에서 클러스터링 시그니처(저장소·버전 제품·고유명사·브랜드·주제 토큰/바이그램)를 추출한다.
 * 오탐 방지를 위해 본문 템플릿 대신 제목·원문 제목·URL·엔티티 위주로 정밀 추출한다.
 */
export function extractStoryProfile(item: FeedItem): StoryProfile {
  const titleJoined = [item.hook_title, item.original_title ?? ""].filter(Boolean).join(" ");
  const cleanTitle = titleJoined.replace(/^@[a-z0-9_]{1,15}:\s*/i, "").replace(/https?:\/\/\S+/g, " ");
  const aliased = normalizeAliases(cleanTitle);

  const repoKeys = new Set<string>();
  const urlAndTitle = `${item.canonical_url} ${titleJoined}`;
  for (const m of urlAndTitle.matchAll(REPO_URL_RE)) {
    const slug = m[1].toLowerCase().replace(/\.git$/, "");
    if (!slug.endsWith("/issues") && !slug.endsWith("/releases") && !slug.startsWith("trending/")) {
      repoKeys.add(slug);
    }
  }
  for (const m of titleJoined.matchAll(EXPLICIT_REPO_RE)) {
    const slug = m[1].toLowerCase();
    // 날짜 패턴(11/24), 일반 슬래시 단어(w/f, i/o) 제외
    if (/^\d+\/\d+$/.test(slug)) continue;
    const [owner, repo] = slug.split("/");
    if (owner.length >= 2 && repo.length >= 3 && !/^\d+$/.test(owner) && !STOPWORDS.has(owner) && !STOPWORDS.has(repo)) {
      repoKeys.add(slug);
    }
  }

  const versionedKeys = new Set<string>();
  const familyVersions = new Map<string, Set<string>>();
  for (const m of aliased.matchAll(VERSIONED_PRODUCT_RE)) {
    const family = canonicalFamily(m[1]);
    const ver = normalizeMajorMinor(m[2]);
    const qualifier = m[3]?.toLowerCase() ?? "";
    const baseKey = `${family}:${ver}`;
    versionedKeys.add(baseKey);
    if (qualifier && qualifier !== "preview") {
      versionedKeys.add(`${baseKey}-${qualifier}`);
    }
    if (!familyVersions.has(family)) familyVersions.set(family, new Set());
    familyVersions.get(family)!.add(ver);
  }

  const distinctiveNames = new Set<string>();
  for (const m of aliased.matchAll(COMPOUND_PRODUCT_RE)) {
    distinctiveNames.add(m[1].toLowerCase().replace(/\s+/g, "-"));
  }

  // 영어·혼합 대문자/카멜케이스·고유 코드네임 추출 (예: Shirudo, OpenWorks, OceanLake, MedChemBench, WorkBuddy)
  const rawEnglishMatches = cleanTitle.match(/\b[A-Za-z][A-Za-z0-9_-]{3,28}\b/g) ?? [];
  for (const rawTok of rawEnglishMatches) {
    const low = rawTok.toLowerCase();
    if (COMMON_TITLE_WORDS.has(low) || /^\d+$/.test(low)) continue;
    const hasInternalUpper = /[a-z][A-Z]/.test(rawTok);
    const hasDigit = /\d/.test(rawTok) && /[a-z]/i.test(rawTok);
    const isCapitalized = /^[A-Z][a-z]{3,}$/.test(rawTok);
    const isAllCapsAcronym = /^[A-Z]{4,10}$/.test(rawTok);
    if (hasInternalUpper || hasDigit || isAllCapsAcronym) {
      distinctiveNames.add(low);
    } else if (isCapitalized && low.length >= 5) {
      distinctiveNames.add(low);
    }
  }

  // 브랜드/엔티티 집합
  const brandEntities = new Set<string>();
  const entityText = normalizeAliases(
    `${cleanTitle} ${item.entities.map((e) => e.name).join(" ")} ${item.author_handle ?? ""}`,
  ).toLowerCase();
  for (const brand of BROAD_BRAND_TOKENS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(entityText)) {
      brandEntities.add(brand);
    }
  }
  if (BROAD_BRAND_TOKENS.has(item.platform_id)) {
    brandEntities.add(item.platform_id);
  }
  if (item.platform_id === "google-deepmind") {
    brandEntities.add("google");
    brandEntities.add("deepmind");
  }

  // 정규화 주제 토큰 + 바이그램 (불용어·단독 숫자·1글자 제거)
  const rawTokens = aliased
    .toLowerCase()
    .replace(/[^0-9a-z가-힣-]+/g, " ")
    .split(/\s+/)
    .map((t) => stripKoParticle(t.replace(/^-+|-+$/g, "")))
    .filter((t) => {
      if (!t || /^\d+$/.test(t)) return false;
      const minLen = /[가-힣]/.test(t) ? 2 : 3;
      if (t.length < minLen) return false;
      if (STOPWORDS.has(t)) return false;
      return true;
    });

  const topicTokens = new Set<string>(rawTokens);
  const topicBigrams = buildBigrams(rawTokens);

  return {
    item,
    timestampMs: itemTimestampMs(item),
    normUrl: normalizeUrlKey(item.canonical_url),
    repoKeys,
    versionedKeys,
    familyVersions,
    distinctiveNames,
    brandEntities,
    topicTokens,
    topicBigrams,
  };
}

/** 동일 제품군에 서로 다른 버전이 명시된 경우 오병합 방지 (예: GPT-5 vs GPT-6.2, Qwen 3.5 vs Qwen 3.8) */
function hasVersionConflict(a: StoryProfile, b: StoryProfile): boolean {
  for (const [family, versA] of a.familyVersions) {
    const versB = b.familyVersions.get(family);
    if (!versB || versB.size === 0 || versA.size === 0) continue;
    let overlap = false;
    for (const v of versA) {
      if (versB.has(v)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) return true;
  }
  return false;
}

/**
 * 두 기사가 진짜 동일 이슈(발표·릴리즈·사건)인지 정밀 판별한다.
 * 단순 일반어/단일 회사명만 겹치는 오탐을 구조적으로 차단한다.
 */
export function areSameStory(a: StoryProfile, b: StoryProfile, windowMs = CLUSTER_WINDOW_MS): boolean {
  if (a.item.lifecycle_status !== b.item.lifecycle_status) return false;
  if (Math.abs(a.timestampMs - b.timestampMs) > windowMs) return false;

  // 1. 정규화 URL 일치
  if (a.normUrl && a.normUrl === b.normUrl) return true;

  // 서로 다른 명시적 버전 충돌 시 즉시 거부 (예: GPT-5 vs GPT-6.2)
  if (hasVersionConflict(a, b)) return false;

  const tokenJ = jaccard(a.topicTokens, b.topicTokens);
  const bigramJ = jaccard(a.topicBigrams, b.topicBigrams);
  const sharedTopicTokens = intersectionCount(a.topicTokens, b.topicTokens);
  const sharedBrands = intersectionCount(a.brandEntities, b.brandEntities);
  const sharedRepos = intersectionCount(a.repoKeys, b.repoKeys);
  const sharedVersioned = intersectionCount(a.versionedKeys, b.versionedKeys);
  const sharedDistinctive = intersectionCount(a.distinctiveNames, b.distinctiveNames);

  // 2. 동일 GitHub/HF 저장소 시그니처 일치
  if (sharedRepos >= 1) return true;

  // 3. 구체적 제품+버전 시그니처 일치 (예: wenxin:5.5, gpt:6.2, qwen:3.8, deepseek:v4, vllm:0.34)
  if (sharedVersioned >= 1) {
    // 같은 특정 버전 모델(예: Wenxin 5.5)을 다룬 기사는 36시간 내 거의 확실한 동일 이슈
    // 단, 전혀 무관한 라운드업 기사 2개가 우연히 겹치지 않도록 최소 주제 호환 또는 단일 포커스 체크
    const focused = a.familyVersions.size <= 2 && b.familyVersions.size <= 2;
    if (focused || tokenJ >= 0.14 || bigramJ >= 0.12 || sharedDistinctive >= 1) {
      return true;
    }
  }

  // 4. 고유 제품명/코드네임(예: Shirudo, OpenWorks, OceanLake, Claude Ship) 일치 + 보조 시그널
  if (sharedDistinctive >= 1) {
    if (sharedDistinctive >= 2) return true;
    if (sharedBrands >= 1) return true;
    if (tokenJ >= 0.18 || bigramJ >= 0.15 || sharedTopicTokens >= 2) return true;
  }

  // 5. 주요 브랜드/엔티티 공유 + 높은 핵심 주제 유사도 (비브랜드 콘텐츠 토큰 최소 2개 이상 일치 필수)
  if (sharedBrands >= 1) {
    let nonBrandShared = 0;
    for (const t of a.topicTokens) {
      if (b.topicTokens.has(t) && !BROAD_BRAND_TOKENS.has(t)) nonBrandShared += 1;
    }
    const combinedSim = tokenJ * 0.65 + bigramJ * 0.35;
    if (nonBrandShared >= 2 && (tokenJ >= 0.42 || combinedSim >= 0.36)) {
      return true;
    }
  }

  // 6. 브랜드가 명시되지 않았더라도 핵심 비불용어 토큰·바이그램이 매우 높은 동일 사건 기사
  if (sharedTopicTokens >= 3 && (tokenJ >= 0.52 || (tokenJ >= 0.4 && bigramJ >= 0.3))) {
    return true;
  }

  return false;
}

/** 대표 카드 선정 점수: 출처 공신력 + 한국어 요약 품질 + 중요도 */
export function representativeScore(item: FeedItem): number {
  let authority = SOURCE_AUTHORITY[item.platform_id] ?? 14;
  if (item.platform_id === "x" && item.author_handle && OFFICIAL_X_HANDLES.has(item.author_handle.toLowerCase())) {
    authority = 18;
  }

  let quality = 0;
  const whatLen = item.what_ko?.trim().length ?? 0;
  if (whatLen >= 80) quality += 12;
  else if (whatLen >= 35) quality += 7;
  else if (whatLen >= 15) quality += 3;

  if (item.highlight_summary?.trim()) quality += 4;
  if ((item.why_ko?.trim().length ?? 0) >= 25) quality += 4;
  if (item.analogy_ko?.trim()) quality += 3;
  if (item.benefit_tag?.trim()) quality += 3;
  quality += Math.min(4, item.terms.length * 1.5);
  if (item.easy_original_ready) quality += 4;

  // 폴백 헤드라인·미번역 한자 잔존 시 감점
  if (/실시간\s+.+속보\s*·/.test(item.hook_title)) quality -= 8;
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(item.hook_title)) quality -= 10;

  const baseImportance = Math.min(14, Math.max(0, (Number(item.importance_score) || 0) * 0.28));
  return authority + quality + baseImportance;
}

function stripRelated(item: FeedItem): FeedItem {
  if (!item.relatedArticles) return item;
  const rest = { ...item };
  delete rest.relatedArticles;
  return rest;
}

export interface StoryClusterOptions {
  windowMs?: number;
}

/**
 * 결정론적 다중 매체 이슈 클러스터러 (`Techmeme` 스타일).
 * - LLM 비용 0원, 완전 결정론적(SSR/CSR hydration 100% 일치).
 * - 클러스터 내 가장 공신력·요약 품질이 높은 기사를 대표 카드로 선정하고,
 *   나머지는 `relatedArticles` 배열로 연결한다.
 */
export class StoryClusterer {
  private readonly windowMs: number;

  constructor(options: StoryClusterOptions = {}) {
    this.windowMs = options.windowMs ?? CLUSTER_WINDOW_MS;
  }

  cluster(items: FeedItem[]): FeedItem[] {
    if (items.length <= 1) return items;

    const profiles = items.map((item) => extractStoryProfile(stripRelated(item)));
    // 최신·고품질 순으로 클러스터 시드를 안정적으로 형성하기 위해 인덱스 순서 유지(결정론적)
    const clusters: StoryProfile[][] = [];

    for (const profile of profiles) {
      let bestClusterIdx = -1;
      let bestMatchStrength = -1;

      for (let c = 0; c < clusters.length; c++) {
        const members = clusters[c];
        // 전이 체이닝(A~B~C 드리프트) 방지: 클러스터 앵커(0번)와 반드시 매칭되거나, 다수 멤버와 매칭돼야 합류
        const anchor = members[0];
        if (!areSameStory(profile, anchor, this.windowMs)) continue;

        // 2개 이상 멤버가 있을 때는 최소 절반 이상과 호환(버전 충돌 0건)
        let conflict = false;
        let matchCount = 1;
        for (let m = 1; m < members.length; m++) {
          if (hasVersionConflict(profile, members[m])) {
            conflict = true;
            break;
          }
          if (areSameStory(profile, members[m], this.windowMs)) {
            matchCount += 1;
          }
        }
        if (conflict) continue;
        if (members.length >= 2 && matchCount < Math.ceil(members.length / 2)) continue;

        const strength = matchCount * 10 + jaccard(profile.topicTokens, anchor.topicTokens);
        if (strength > bestMatchStrength) {
          bestMatchStrength = strength;
          bestClusterIdx = c;
        }
      }

      if (bestClusterIdx >= 0) {
        clusters[bestClusterIdx].push(profile);
      } else {
        clusters.push([profile]);
      }
    }

    return clusters.map((members) => {
      if (members.length === 1) return members[0].item;

      // 대표 카드 선정: 출처 공신력 + 요약 품질 + 중요도 최고점 (동점 시 더 이른 공식 발표 우선)
      const ranked = [...members].sort((a, b) => {
        const scoreDiff = representativeScore(b.item) - representativeScore(a.item);
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
        return b.timestampMs - a.timestampMs;
      });

      const rep = ranked[0].item;
      const related = ranked.slice(1).map((m) => stripRelated(m.item));

      // 출처 플랫폼 합집합 및 카운트 갱신
      const mergedPlatforms = [
        rep.platform_id,
        ...rep.source_platforms,
        ...related.flatMap((r) => [r.platform_id, ...r.source_platforms]),
      ];
      const uniquePlatforms = [...new Set(mergedPlatforms)];

      // 대표 기사에 published_at이 없으면 클러스터 내 가장 최신 유효 시각 보완
      let publishedAt = rep.published_at;
      if (!publishedAt) {
        const withDate = related
          .filter((r) => r.published_at)
          .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
        if (withDate.length > 0) publishedAt = withDate[0].published_at;
      }

      return {
        ...rep,
        published_at: publishedAt,
        source_platforms: uniquePlatforms,
        source_count: Math.max(rep.source_count, uniquePlatforms.length, 1 + related.length),
        cluster_id: rep.id,
        relatedArticles: related,
      };
    });
  }
}

export function clusterStories(items: FeedItem[], options?: StoryClusterOptions): FeedItem[] {
  return new StoryClusterer(options).cluster(items);
}

/** 플랫폼 표시명 간결화 (X → 𝕏, 괄호 부연 제거) */
export function compactPlatformLabel(platformId: string, platformsById: Map<string, Platform>): string {
  if (platformId === "x") return "𝕏";
  const raw = platformsById.get(platformId)?.name ?? platformId;
  return raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
}

/**
 * 대표 카드 하단 무채색 관련 보도 캡션 생성:
 * - KO: `외 관련 보도 3건 · The Verge, 36Kr AI, 𝕏 등`
 * - EN: `+3 more · The Verge, 36Kr AI, 𝕏`
 */
export function formatRelatedCaption(
  item: Pick<FeedItem, "platform_id" | "relatedArticles">,
  platformsById: Map<string, Platform>,
  lang: "ko" | "en" = "ko",
): string | null {
  const related = item.relatedArticles;
  if (!related || related.length === 0) return null;

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const r of related) {
    const label = compactPlatformLabel(r.platform_id, platformsById);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  const shown = labels.slice(0, 3);
  const hasMoreSources = labels.length > 3 || related.length > shown.length;
  const sourceList = shown.join(", ");

  if (lang === "en") {
    return `+${related.length} more · ${sourceList}${labels.length > 3 ? " +" : ""}`;
  }
  return `외 관련 보도 ${related.length}건 · ${sourceList}${hasMoreSources ? " 등" : ""}`;
}
