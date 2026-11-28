/**
 * 5분 엣지 속보 스캐너 (Cloudflare Cron `*\/5 * * * *` 1개) — 30개 1차 AI 진원지 3교대 순환.
 * - 매 실행 `Math.floor(UTC분 / 5) % 3` 조(Shard 0·1·2)의 10개 소스만 3.5초 타임아웃으로 병렬 조회 → 15분마다 30개 전부 1바퀴
 * - 하위 요청 상한: 피드 10 + Gemini ≤3 + GitHub dispatch ≤1 + D1 2 = 최대 16 (무료 50 한도의 1/3)
 * - 본문은 앞부분 바이트만 스트림으로 읽고 끊는다 (DOM 파서 없음, CPU·메모리 최소)
 * - Shard 0(00·15·30·45분)은 GitHub `workflow_dispatch` 로 58개 전체 심층 파이프라인을 정각에 깨운다
 * - 진짜 신규 기사가 있을 때만 Gemini 1회 배치, `ai:false` 판정 기사는 즉시 탈락
 */
import { GATED_PLATFORMS, isAiSignal } from "./ai-gate";
import type { EdgeEnv } from "./cf-types";
import { restoreOriginals } from "./restore";
import { SEEN_CAP, laterIso, parseMeta, readRows, titleKey, upsert, urlKey, type MetaRow } from "./feed-store";
import { resetMemo } from "./api";

export type SourceKind = "rss" | "hn" | "hf_papers" | "hf_models" | "juejin" | "v2ex";

export interface EdgeSource {
  id: string;
  platform: string;
  category: "industry" | "dev" | "social" | "research" | "llm_chat";
  kind: SourceKind;
  url: string;
  lang: "ko" | "en";
  /** 0·1·2 — 5분마다 한 조씩 돈다 */
  shard: 0 | 1 | 2;
  /** 시간대 표기가 없는 로컬 시각(예: AI타임스 '2026-11-28 18:31:30')의 오프셋 */
  tz?: string;
  limit: number;
  /** 앞부분만 훑을 글자 수 (본문 전문을 싣는 피드만 크게) */
  maxText?: number;
  /** 종합 피드: AI 순도 게이트 통과 글만 */
  aiOnly?: boolean;
}

const HN = "https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E15&hitsPerPage=8&query=";

/**
 * 30개 엣지 수맥 — 2026-11-28 Cloudflare 엣지(표준 UA)에서 HTTP 200 + 실제 피드 본문을 실측 확인한 주소만 배정.
 * 차단·대체: Reddit 3곳(엣지에 'Welcome to Reddit' HTML 차단 페이지) → HN LLM·PyTorch KR·Zenn LLM,
 *           QbitAI(3.5초 타임아웃) → ITmedia AI+, 36Kr(403) → V2EX 핫토픽, VentureBeat 본 피드(429) → 공식 feedburner 피드,
 *           Anthropic(공식 RSS 없음) → 공개 RSS 미러, Meta AI(블로그 RSS 404) → Meta Engineering AI Research,
 *           Mistral(공식 RSS 없음) → Hugging Face mistralai 신규 모델 API
 * 2026-11-28 HF Trending Models·Spaces(개인 데모·모델 파일 업로드 로그) 제거 → 발행 시각이 명확한 AI 전문 매체
 *           The Decoder · SiliconANGLE AI 로 교체 (엣지 HTTP 200 실측)
 */
export const EDGE_SOURCES: EdgeSource[] = [
  // ── Shard 0 (00·05 이후 15분 간격: 00, 15, 30, 45분) ──
  { id: "openai", platform: "openai", category: "industry", kind: "rss", lang: "en", shard: 0, limit: 4, url: "https://openai.com/news/rss.xml" },
  { id: "google-ai", platform: "google-ai", category: "industry", kind: "rss", lang: "en", shard: 0, limit: 4, url: "https://blog.google/innovation-and-ai/technology/ai/rss/" },
  { id: "hf-papers", platform: "huggingface", category: "research", kind: "hf_papers", lang: "en", shard: 0, limit: 4, maxText: 160_000, url: "https://huggingface.co/api/daily_papers?limit=6" },
  { id: "mistral", platform: "mistral-ai", category: "llm_chat", kind: "hf_models", lang: "en", shard: 0, limit: 3, maxText: 60_000, url: "https://huggingface.co/api/models?author=mistralai&sort=createdAt&limit=5" },
  { id: "hn", platform: "hacker-news", category: "dev", kind: "hn", lang: "en", shard: 0, limit: 4, aiOnly: true, maxText: 60_000, url: `${HN}AI` },
  { id: "juejin", platform: "juejin", category: "dev", kind: "juejin", lang: "en", shard: 0, limit: 4, aiOnly: true, maxText: 80_000, url: "https://api.juejin.cn/content_api/v1/content/article_rank?category_id=6809637773935378440&type=hot" },
  { id: "aitimes", platform: "aitimes", category: "industry", kind: "rss", lang: "ko", shard: 0, tz: "+09:00", limit: 6, url: "https://www.aitimes.com/rss/allArticle.xml" },
  { id: "verge", platform: "the-verge-ai", category: "industry", kind: "rss", lang: "en", shard: 0, limit: 4, maxText: 45_000, url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "simon", platform: "simon-willison", category: "dev", kind: "rss", lang: "en", shard: 0, limit: 3, maxText: 45_000, url: "https://simonwillison.net/tags/ai.atom" },
  { id: "marktechpost", platform: "marktechpost", category: "research", kind: "rss", lang: "en", shard: 0, limit: 3, maxText: 45_000, url: "https://www.marktechpost.com/feed/" },
  // ── Shard 1 (05, 20, 35, 50분) ──
  { id: "anthropic", platform: "anthropic", category: "industry", kind: "rss", lang: "en", shard: 1, limit: 4, url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml" },
  { id: "deepmind", platform: "google-deepmind", category: "research", kind: "rss", lang: "en", shard: 1, limit: 4, url: "https://deepmind.google/blog/rss.xml" },
  { id: "the-decoder", platform: "the-decoder", category: "industry", kind: "rss", lang: "en", shard: 1, limit: 4, maxText: 30_000, url: "https://the-decoder.com/feed/" },
  { id: "msr", platform: "microsoft-research", category: "research", kind: "rss", lang: "en", shard: 1, limit: 3, aiOnly: true, maxText: 45_000, url: "https://www.microsoft.com/en-us/research/feed/" },
  { id: "qwen", platform: "qwen", category: "llm_chat", kind: "rss", lang: "en", shard: 1, limit: 3, url: "https://qwenlm.github.io/blog/index.xml" },
  { id: "hn-llm", platform: "hacker-news", category: "dev", kind: "hn", lang: "en", shard: 1, limit: 4, aiOnly: true, maxText: 60_000, url: `${HN}LLM` },
  { id: "geeknews", platform: "geeknews", category: "dev", kind: "rss", lang: "ko", shard: 1, limit: 5, aiOnly: true, url: "https://feeds.feedburner.com/geeknews-feed" },
  { id: "techcrunch", platform: "techcrunch-ai", category: "industry", kind: "rss", lang: "en", shard: 1, limit: 4, url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "latent-space", platform: "latent-space", category: "industry", kind: "rss", lang: "en", shard: 1, limit: 2, maxText: 60_000, url: "https://latent.space/feed" },
  { id: "venturebeat", platform: "venturebeat-ai", category: "industry", kind: "rss", lang: "en", shard: 1, limit: 4, aiOnly: true, url: "https://feeds.feedburner.com/venturebeat/SZYF" },
  // ── Shard 2 (10, 25, 40, 55분) ──
  { id: "siliconangle", platform: "siliconangle-ai", category: "industry", kind: "rss", lang: "en", shard: 2, limit: 4, maxText: 30_000, url: "https://siliconangle.com/category/ai/feed/" },
  { id: "meta-ai", platform: "meta-ai", category: "research", kind: "rss", lang: "en", shard: 2, limit: 3, maxText: 45_000, url: "https://engineering.fb.com/category/ai-research/feed/" },
  { id: "lobsters", platform: "lobsters", category: "social", kind: "rss", lang: "en", shard: 2, limit: 4, aiOnly: true, url: "https://lobste.rs/t/ai.rss" },
  { id: "pytorch-kr", platform: "pytorch-kr", category: "social", kind: "rss", lang: "ko", shard: 2, limit: 4, aiOnly: true, maxText: 45_000, url: "https://discuss.pytorch.kr/latest.rss" },
  { id: "zenn", platform: "zenn", category: "dev", kind: "rss", lang: "en", shard: 2, limit: 4, aiOnly: true, url: "https://zenn.dev/topics/llm/feed" },
  { id: "itmedia", platform: "itmedia-aiplus", category: "industry", kind: "rss", lang: "en", shard: 2, tz: "+09:00", limit: 4, url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml" },
  { id: "v2ex", platform: "v2ex", category: "social", kind: "v2ex", lang: "en", shard: 2, limit: 3, aiOnly: true, maxText: 80_000, url: "https://www.v2ex.com/api/topics/hot.json" },
  { id: "import-ai", platform: "import-ai", category: "research", kind: "rss", lang: "en", shard: 2, limit: 2, maxText: 45_000, url: "https://importai.substack.com/feed" },
  { id: "ars", platform: "ars-technica-ai", category: "industry", kind: "rss", lang: "en", shard: 2, limit: 3, maxText: 30_000, url: "https://arstechnica.com/ai/feed/" },
  { id: "mit-tr", platform: "mit-tech-review", category: "industry", kind: "rss", lang: "en", shard: 2, limit: 3, maxText: 45_000, url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
];

export const SHARD_COUNT = 3;

/** 5분 크론 시각 → 조 번호 (00·15·30·45분 = 0) */
export function shardOf(now: Date): 0 | 1 | 2 {
  return (Math.floor(now.getUTCMinutes() / 5) % SHARD_COUNT) as 0 | 1 | 2;
}

export function sourcesFor(shard: number): EdgeSource[] {
  return EDGE_SOURCES.filter((s) => s.shard === shard);
}

export const FETCH_TIMEOUT_MS = 3500;
export const MAX_TEXT = 16_000;
export const FRESH_WINDOW_MS = 6 * 3_600_000;
export const EDGE_TTL_MS = 36 * 3_600_000;
export const EDGE_CAP = 40;
export const MAX_NEW_PER_RUN = 10;
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const GEMINI_TIMEOUT_MS = 45_000;
const GH_DISPATCH_URL = "https://api.github.com/repos/rlawlstjr346-collab/ai-radar/actions/workflows/collect.yml/dispatches";

export interface RawEntry {
  source: EdgeSource;
  title: string;
  link: string;
  published: number | null;
  description: string;
  publisher: string | null;
}

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY[m] ?? m);
}

const stripTags = (s: string) => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

/** 시간대 없는 'YYYY-MM-DD HH:MM:SS' 는 소스 오프셋(tz)으로, 날짜만 있으면 null(→ 첫 포착 시각 사용) */
export function parseDate(raw: string | null, tz?: string): number | null {
  if (!raw) return null;
  const s = decode(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const local = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const t = local ? Date.parse(`${local[1]}T${local[2]}${tz ?? "Z"}`) : Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isoMs = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/** JSON API 응답 → 공통 엔트리 (HN·HF·Juejin·V2EX) */
function parseJson(body: string, source: EdgeSource): Array<Omit<RawEntry, "source">> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  switch (source.kind) {
    case "hn":
      return arr((data as { hits?: unknown }).hits).map((h) => ({
        title: str(h.title).trim(),
        link: str(h.url) || `https://news.ycombinator.com/item?id=${h.objectID}`,
        published: isoMs(h.created_at),
        description: "",
        publisher: null,
      }));
    case "hf_papers":
      return arr(data).map((d) => {
        const p = (d.paper ?? {}) as Record<string, unknown>;
        return {
          title: str(p.title ?? d.title).trim(),
          link: `https://huggingface.co/papers/${str(p.id)}`,
          published: isoMs(p.submittedOnDailyAt) ?? isoMs(d.publishedAt),
          description: str(p.ai_summary || p.summary || d.summary).slice(0, 400),
          publisher: null,
        };
      });
    case "hf_models":
      return arr(data).map((m) => {
        const id = str(m.id);
        const tags = Array.isArray(m.tags) ? (m.tags as unknown[]).map(String) : [];
        const kind = `Hugging Face AI model${m.pipeline_tag ? ` · ${str(m.pipeline_tag)}` : ""}`;
        return {
          title: id,
          link: `https://huggingface.co/${id}`,
          published: isoMs(m.createdAt),
          description: `${kind} · likes ${Number(m.likes) || 0} · ${tags.filter((t) => !t.includes(":")).slice(0, 6).join(", ")}`,
          publisher: null,
        };
      });
    case "juejin":
      return arr((data as { data?: unknown }).data).map((d) => {
        const c = (d.content ?? {}) as Record<string, unknown>;
        const ctime = Number(c.ctime) || 0;
        return {
          title: str(c.title).trim(),
          link: `https://juejin.cn/post/${str(c.content_id)}`,
          published: ctime > 0 ? ctime * 1000 : null,
          description: str(c.brief).slice(0, 400),
          publisher: null,
        };
      });
    case "v2ex":
      return arr(data).map((t) => ({
        title: str(t.title).trim(),
        link: str(t.url),
        published: Number(t.created) > 0 ? Number(t.created) * 1000 : null,
        description: str(t.content).replace(/\s+/g, " ").slice(0, 400),
        publisher: null,
      }));
    default:
      return [];
  }
}

function parseXml(body: string, source: EdgeSource): Array<Omit<RawEntry, "source">> {
  const out: Array<Omit<RawEntry, "source">> = [];
  for (const block of body.split(/<item[\s>]|<entry[\s>]/i).slice(1)) {
    const rawTitle = tag(block, "title");
    let link = tag(block, "link")?.trim() ?? "";
    if (!link) link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    link = decode(link);
    if (!rawTitle || !link.startsWith("https://")) continue;
    const publisher = tag(block, "source");
    let title = stripTags(rawTitle);
    if (publisher) {
      const pub = stripTags(publisher);
      if (title.endsWith(` - ${pub}`)) title = title.slice(0, -(pub.length + 3)).trim();
    }
    out.push({
      title,
      link,
      published: parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date"), source.tz),
      description: stripTags(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "").slice(0, 400),
      publisher: publisher ? stripTags(publisher) : null,
    });
  }
  return out;
}

/** 피드 텍스트 → 엔트리 (종합 피드는 AI 순도 게이트 통과 글만, 소스별 limit 까지) */
export function parseFeed(text: string, source: EdgeSource): RawEntry[] {
  const body = text.slice(0, source.maxText ?? MAX_TEXT);
  const raw = source.kind === "rss" ? parseXml(body, source) : parseJson(body, source);
  const out: RawEntry[] = [];
  for (const e of raw) {
    if (out.length >= source.limit) break;
    if (!e.title || !e.link.startsWith("https://")) continue;
    if ((source.aiOnly || GATED_PLATFORMS.has(source.platform)) && !isAiSignal(e.title, e.description)) continue;
    out.push({ source, ...e });
  }
  return out;
}

/** 응답 본문을 앞부분 maxBytes 만 읽고 연결을 끊는다 (800KB 짜리 전문 피드도 CPU·메모리 최소) */
async function readPrefix(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += dec.decode(value, { stream: true });
    }
    out += dec.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
  return out;
}

export interface FetchResult {
  text: string | null;
  status: string;
  ms: number;
}

async function fetchText(source: EdgeSource, fetchImpl: typeof fetch): Promise<FetchResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(source.url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Radar-Edge/1.0)",
        "Accept-Language": source.lang === "ko" ? "ko-KR,ko;q=0.9" : "en-US,en;q=0.9",
        Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) return { text: null, status: String(res.status), ms: Date.now() - t0 };
    const text = await readPrefix(res, (source.maxText ?? MAX_TEXT) * 3);
    // 200 이어도 차단·안내 HTML 이면 실패로 센다 (예: Reddit 'Welcome to Reddit')
    if (/^\s*(?:<!doctype html|<html)/i.test(text)) return { text: null, status: "html", ms: Date.now() - t0 };
    return { text, status: "200", ms: Date.now() - t0 };
  } catch (e) {
    return { text: null, status: (e as Error)?.name === "AbortError" ? "timeout" : "error", ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

// ── 한국어 규칙 대화체 (Gemini 실패 시 폴백) ────────────────────────────────
const CJK_FOREIGN = /[぀-ヿ一-鿿]/;
const ENDINGS: Array<[RegExp, string]> = [
  [/했다$/, "했어요"], [/됐다$|되었다$/, "됐어요"], [/한다$/, "해요"], [/된다$/, "돼요"], [/있다$/, "있어요"],
  [/없다$/, "없어요"], [/이다$/, "이에요"], [/였다$/, "였어요"], [/었다$/, "었어요"], [/았다$/, "았어요"],
  [/합니다$/, "해요"], [/습니다$/, "어요"], [/입니다$/, "이에요"],
];

export function koSentence(s: string): string | null {
  const t = s.trim().replace(/[.!]+$/, "");
  if (t.length < 12 || CJK_FOREIGN.test(t)) return null;
  if (/요$/.test(t)) return `${t}.`;
  for (const [re, rep] of ENDINGS) if (re.test(t)) return `${t.replace(re, rep)}.`;
  return null;
}

export function ruleSummary(e: RawEntry): string | null {
  const sentences = e.description.split(/(?<=[.!?])\s+/).map(koSentence).filter((x): x is string => Boolean(x));
  if (sentences.length > 0) return sentences.slice(0, 2).join(" ");
  return e.publisher ? `${e.publisher}에서 방금 전한 소식이에요. 자세한 내용은 원문에서 바로 확인할 수 있어요.` : null;
}

// ── Gemini 1회 배치 ───────────────────────────────────────────────────────
export interface GlossaryEntry {
  term: string;
  desc: string;
}

export interface Edited {
  title_ko: string;
  summary: string;
  vision: string | null;
  glossary?: GlossaryEntry[];
}

/** Gemini glossary 검증: 최대 4개, 용어 1~30자, 쉬운 풀이 8~140자 '~요.' 로 끝, 한자·가나 없음 */
export function validGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GlossaryEntry[] = [];
  for (const g of raw as Array<Record<string, unknown>>) {
    const term = typeof g?.term === "string" ? restoreOriginals(g.term.trim()) : "";
    const desc = typeof g?.desc === "string" ? restoreOriginals(g.desc.trim()) : "";
    if (!term || term.length > 30 || CJK_FOREIGN.test(term) || CJK_FOREIGN.test(desc)) continue;
    if (desc.length < 8 || desc.length > 140 || !/요[.!]?$/.test(desc)) continue;
    if (out.some((x) => x.term.toLowerCase() === term.toLowerCase())) continue;
    out.push({ term, desc });
    if (out.length >= 4) break;
  }
  return out;
}

const PROMPT = `너는 AI 뉴스를 처음 보는 사람에게 설명하는 한국어 뉴스 에디터야. 아래 기사마다 원문(title, description)에 있는 사실만으로 써 줘.
숫자·이름을 지어내지 말고, 일본어 가나·중국어 한자는 쓰지 마.
영문 모델명·회사·제품명과 기술 약어(MCP, GGUF, SDK, API, LLM, RAG, GPU, NPU, VRAM, CLI, MoE, LoRA, Agent, CUDA 등)는 '엠시피'·'지지유에프'처럼 한글 소리로 옮기지 말고 영문 대소문자 원형 그대로 써.
숫자도 '이 년'·'열 배'처럼 한글로 풀지 말고 2년·10배·30B·70% 처럼 아라비아 숫자 원형 그대로 써.
- title_ko: 자연스러운 한국어 헤드라인 18~45자, 친근한 대화체(~했어요/~나왔어요/~예요/궁금증 ?), 말머리([ ]) 금지
- summary: 초보자용 쉬운 대화체 2문장, 둘 다 '~요.'로 끝. 제목 반복·'쉽게 말해'·번역투 금지
- vision: 2문장. '앞으로 ~'로 시작해 이 변화로 일상·업무에서 무엇이 가능해지는지 + '우리는 ~에 주목해 볼 수 있어요.'
- ai: 기사가 AI(모델·에이전트·AI 제품·AI 연구·AI 산업·AI 정책)와 직접 관련 있으면 true, AI 와 무관한 일반 개발·보안 사건·하드웨어·앱 소식이면 false (false 면 다른 필드는 빈 문자열)
- glossary: 이 기사에 나온, 초보자가 어려워할 영문 약어·기술 개념 최대 4개. term 은 기사 표기 그대로, desc 는 '~요.'로 끝나는 쉬운 비유 1문장 (없으면 [])
JSON 배열만 출력: [{"i":0,"ai":true,"title_ko":"...","summary":"...","vision":"...","glossary":[{"term":"MCP","desc":"AI가 내 파일이나 외부 앱을 직접 연결해 쓰도록 만든 표준 플러그 규격이에요."}]}]
기사:
`;

export function validEdit(e: Partial<Edited>): e is Edited {
  const ok = (s: unknown, min: number) => typeof s === "string" && s.trim().length >= min && !CJK_FOREIGN.test(s);
  return ok(e.title_ko, 8) && !/^\s*[[【]/.test(String(e.title_ko)) && ok(e.summary, 20) && /요[.!?]?$/.test(String(e.summary).trim()) && !/쉽게 말해/.test(String(e.summary));
}

function extractText(payload: Record<string, unknown>): string {
  const steps = (payload.steps as Array<Record<string, unknown>> | undefined) ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type !== "model_output") continue;
    const content = (steps[i].content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (text.trim()) return text;
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  return "";
}

export interface GeminiResult {
  edits: Map<number, Edited>;
  /** Gemini 가 `ai:false` 로 판정한 기사 번호 → 즉시 탈락 */
  notAi: Set<number>;
  calls: number;
  model: string | null;
}

export async function geminiEdit(entries: RawEntry[], key: string, fetchImpl: typeof fetch): Promise<GeminiResult> {
  const input = entries.map((e, i) => ({ i, lang: e.source.lang, source: e.publisher ?? e.source.platform, title: e.title, description: e.description.slice(0, 300) }));
  let calls = 0;
  for (const model of GEMINI_MODELS) {
    calls += 1;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
    try {
      const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": "2026-05-20" },
        body: JSON.stringify({ model, input: PROMPT + JSON.stringify(input), response_format: { type: "text", mime_type: "application/json" } }),
      });
      if (!res.ok) continue; // 429·503 → 다음 모델 (쿼터 분산)
      const text = extractText((await res.json()) as Record<string, unknown>).replace(/^```(?:json)?\s*|\s*```$/g, "");
      const rows = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as Array<Partial<Edited> & { i?: number }>;
      const edits = new Map<number, Edited>();
      const notAi = new Set<number>();
      for (const raw of rows as Array<Partial<Edited> & { i?: number; ai?: unknown; glossary?: unknown }>) {
        const idx = raw.i;
        if (typeof idx === "number" && raw.ai === false) {
          notAi.add(idx);
          continue;
        }
        // 억지 한글 음차(엠시피·이 년)는 검증 전에 원형(MCP·2년)으로 되돌린다
        const r = {
          ...raw,
          title_ko: typeof raw.title_ko === "string" ? restoreOriginals(raw.title_ko) : raw.title_ko,
          summary: typeof raw.summary === "string" ? restoreOriginals(raw.summary) : raw.summary,
          vision: typeof raw.vision === "string" ? restoreOriginals(raw.vision) : raw.vision,
        };
        if (typeof idx === "number" && validEdit(r)) {
          const vision = typeof r.vision === "string" && r.vision.startsWith("앞으로") && !CJK_FOREIGN.test(r.vision) ? r.vision.trim() : null;
          edits.set(idx, { title_ko: r.title_ko.trim(), summary: r.summary.trim(), vision, glossary: validGlossary(raw.glossary) });
        }
      }
      return { edits, notAi, calls, model };
    } catch {
      continue;
    } finally {
      clearTimeout(t);
    }
  }
  return { edits: new Map(), notAi: new Set(), calls, model: null };
}

// ── 아이템 조립 ─────────────────────────────────────────────────────────
async function shortHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildEdgeItem(e: RawEntry, edit: Edited | null, nowIso: string): Promise<Record<string, unknown> | null> {
  const rawTitle = edit?.title_ko ?? (e.source.lang === "ko" ? e.title : null);
  const rawSummary = edit?.summary ?? (e.source.lang === "ko" ? ruleSummary(e) : null);
  const title = rawTitle ? restoreOriginals(rawTitle) : null;
  const summary = rawSummary ? restoreOriginals(rawSummary) : null;
  if (!title || !summary || CJK_FOREIGN.test(title)) return null;
  const published = e.published !== null && e.published <= Date.parse(nowIso) + 5 * 60_000 ? new Date(Math.min(e.published, Date.parse(nowIso))).toISOString() : nowIso;
  const h = await shortHash(urlKey(e.link));
  return {
    id: `live-e${h}`,
    dedup_key: `url:${h}`,
    platform_id: e.source.platform,
    category: e.source.category,
    canonical_url: e.link,
    thumbnail_url: null,
    image_url: null,
    importance_score: 12,
    source_count: 1,
    source_platforms: [e.source.platform],
    author_handle: null,
    lifecycle_status: "hot",
    published_at: published,
    fetched_at: nowIso,
    first_seen_at: nowIso,
    created_at: published,
    original_title: e.title,
    title_ko: title,
    hook_title: title,
    benefit_tag: null,
    context_ko: e.publisher ? `${e.publisher} 보도` : null,
    what_ko: summary,
    analogy_ko: null,
    why_ko: null,
    caveats_ko: null,
    highlight_summary: summary,
    easy_summary_ko: summary,
    vision_ko: edit?.vision ?? null,
    difficulty: 1,
    terms: [],
    entities: [],
    easy_original_ready: false,
    related_articles: [],
    cluster_size: 1,
    edge: true,
    ...(edit?.glossary && edit.glossary.length > 0 ? { glossary: edit.glossary } : {}),
  };
}

export interface SourceReport {
  id: string;
  status: string;
  ms: number;
  entries: number;
}

export interface ScanReport {
  shard: number;
  sources: SourceReport[];
  fetched: number;
  failed_sources: string[];
  candidates: number;
  fresh_new: number;
  published: number;
  deferred: number;
  non_ai_dropped: number;
  gemini_calls: number;
  gemini_model: string | null;
  /** GitHub workflow_dispatch 응답 코드 (204 = 성공, null = 이번 조는 호출 안 함) */
  dispatch: string | null;
  subrequests: number;
  d1_queries: number;
  rows_read: number;
  rows_written: number;
  ms: number;
}

/** 58개 전체 심층 파이프라인(GitHub Actions collect.yml)을 즉시 깨운다 — 204 가 성공 */
export async function dispatchCollect(token: string, fetchImpl: typeof fetch): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetchImpl(GH_DISPATCH_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-radar-edge-cron",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    return String(res.status);
  } catch (e) {
    return (e as Error)?.name === "AbortError" ? "timeout" : "error";
  } finally {
    clearTimeout(t);
  }
}

export interface ScanOptions {
  /** 지정하지 않으면 now 의 UTC 분으로 계산 */
  shard?: number;
  /** Shard 0 에서 GitHub dispatch 를 부를지 (크론은 true, 수동 측정은 기본 false) */
  dispatch?: boolean;
}

/** 5분 크론 본체 */
export async function runEdgeScan(env: EdgeEnv, now = new Date(), fetchImpl: typeof fetch = fetch, opts: ScanOptions = {}): Promise<ScanReport> {
  const t0 = Date.now();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const shard = opts.shard ?? shardOf(now);
  const sources = sourcesFor(shard);
  const wantDispatch = shard === 0 && (opts.dispatch ?? true) && Boolean(env.GH_DISPATCH_TOKEN);
  const [rows, dispatch, ...fetched] = await Promise.all([
    readRows(env.DB, ["meta", "edge", "seen"]),
    wantDispatch ? dispatchCollect(env.GH_DISPATCH_TOKEN!, fetchImpl) : Promise.resolve(null),
    ...sources.map((s) => fetchText(s, fetchImpl)),
  ]);
  const texts = fetched.map((f) => f.text);
  const rowsRead = rows.size;
  const seen = new Set<string>(safeArray<string>(rows.get("seen")));
  seen.delete("");
  let edge = safeArray<Record<string, unknown>>(rows.get("edge"));
  for (const it of edge) {
    seen.add(urlKey(String(it.canonical_url ?? "")));
    seen.add(titleKey(String(it.original_title ?? "")));
  }
  const isSeen = (e: RawEntry) => seen.has(urlKey(e.link)) || (titleKey(e.title) !== "" && seen.has(titleKey(e.title)));

  const perSource = texts.map((t, i) => (t ? parseFeed(t, sources[i]) : []));
  const entries = perSource.flat();
  const fresh = entries.filter((e) => (e.published === null || nowMs - e.published <= FRESH_WINDOW_MS) && !isSeen(e));
  const uniq = Array.from(new Map(fresh.map((e) => [urlKey(e.link), e])).values())
    .sort((a, b) => (b.published ?? nowMs) - (a.published ?? nowMs))
    .slice(0, MAX_NEW_PER_RUN);

  let gem: GeminiResult = { edits: new Map(), notAi: new Set(), calls: 0, model: null };
  if (uniq.length > 0 && env.GEMINI_API_KEY) gem = await geminiEdit(uniq, env.GEMINI_API_KEY, fetchImpl);

  const built: Record<string, unknown>[] = [];
  let deferred = 0;
  let nonAi = 0;
  const markSeen = (e: RawEntry) => {
    seen.add(urlKey(e.link));
    if (titleKey(e.title)) seen.add(titleKey(e.title));
  };
  for (let i = 0; i < uniq.length; i++) {
    if (gem.notAi.has(i)) {
      // Gemini 가 AI 무관으로 판정 → 즉시 탈락, 다시는 부르지 않게 seen 에 기록
      nonAi += 1;
      markSeen(uniq[i]);
      continue;
    }
    const item = await buildEdgeItem(uniq[i], gem.edits.get(i) ?? null, nowIso);
    if (item) {
      built.push(item);
      markSeen(uniq[i]);
    } else {
      // 영문 + Gemini 실패 → 다음 주기에 한 번만 더 시도하고, 두 번째도 실패하면 포기 (같은 기사로 Gemini 를 계속 부르지 않게)
      deferred += 1;
      const k = urlKey(uniq[i].link);
      if (seen.has(`r:${k}`)) seen.add(k);
      else seen.add(`r:${k}`);
    }
  }

  const prev = parseMeta(rows.get("meta"));
  edge = [...built, ...edge]
    .filter((it) => nowMs - Date.parse(String(it.first_seen_at ?? it.fetched_at ?? nowIso)) <= EDGE_TTL_MS)
    .slice(0, EDGE_CAP);
  const meta: MetaRow = {
    generated_at: built.length > 0 ? laterIso(nowIso, prev?.generated_at) : prev?.generated_at ?? nowIso,
    scanned_at: nowIso,
    base_generated_at: prev?.base_generated_at ?? "",
    base_chunks: prev?.base_chunks ?? 0,
    count: prev?.count ?? 0,
    edge_count: edge.length,
  };
  const statements = built.length > 0 || deferred > 0 || nonAi > 0
    ? [upsert(env.DB, "edge", JSON.stringify(edge), nowIso), upsert(env.DB, "seen", JSON.stringify(Array.from(seen).slice(-SEEN_CAP)), nowIso), upsert(env.DB, "meta", JSON.stringify(meta), nowIso)]
    : [upsert(env.DB, "meta", JSON.stringify(meta), nowIso)];
  await env.DB.batch(statements);
  resetMemo();
  return {
    shard,
    sources: sources.map((s, i) => ({ id: s.id, status: fetched[i].status, ms: fetched[i].ms, entries: perSource[i].length })),
    fetched: texts.filter(Boolean).length,
    failed_sources: sources.flatMap((s, i) => (texts[i] ? [] : [`${s.id}:${fetched[i].status}`])),
    candidates: entries.length,
    fresh_new: uniq.length,
    published: built.length,
    deferred,
    non_ai_dropped: nonAi,
    gemini_calls: gem.calls,
    gemini_model: gem.model,
    dispatch,
    subrequests: sources.length + gem.calls + (wantDispatch ? 1 : 0) + 2,
    d1_queries: 2,
    rows_read: rowsRead,
    rows_written: statements.length,
    ms: Date.now() - t0,
  };
}

function safeArray<T>(raw: string | undefined): T[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
