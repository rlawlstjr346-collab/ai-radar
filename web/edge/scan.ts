/**
 * 5분 엣지 속보 스캐너 (Cloudflare Cron `*\/5 * * * *` 1개).
 * - 초경량 피드 5개만 3초 타임아웃으로 병렬 조회 (하위 요청: 피드 5 + D1 2 + Gemini ≤3 = 최대 10)
 * - DOM 파서 없이 앞부분 60KB 만 indexOf/정규식으로 훑어 CPU 를 아낀다
 * - 진짜 신규 기사가 있을 때만 Gemini 1회 배치 (없으면 Gemini 0회, D1 메타 1행만 갱신)
 * - Gemini 실패(429 등) 시: 한국어 기사는 규칙 대화체로 즉시 게시, 영문 기사는 다음 주기로 미룬다
 */
import type { EdgeEnv } from "./cf-types";
import { SEEN_CAP, laterIso, parseMeta, readRows, titleKey, upsert, urlKey, type MetaRow } from "./feed-store";
import { resetMemo } from "./api";

export interface EdgeSource {
  id: string;
  platform: string;
  category: "industry" | "dev" | "social" | "research" | "llm_chat";
  kind: "rss" | "hn";
  url: string;
  lang: "ko" | "en";
  /** 시간대 표기가 없는 로컬 시각(예: AI타임스 '2026-11-28 18:31:30')의 오프셋 */
  tz?: string;
  limit: number;
  /** 앞부분만 훑을 바이트 수 (본문 전문을 싣는 Atom 피드만 크게) */
  maxText?: number;
  /** 종합 피드: AI 관련 글만 통과 */
  aiOnly?: boolean;
}

export const EDGE_SOURCES: EdgeSource[] = [
  // 구글 뉴스 RSS 는 Cloudflare 엣지에서 매번 3초 타임아웃(실측) → 국내 개발자 커뮤니티 긱뉴스로 대체
  { id: "geeknews", platform: "geeknews", category: "dev", kind: "rss", lang: "ko", limit: 5, aiOnly: true,
    url: "https://feeds.feedburner.com/geeknews-feed" },
  { id: "hn", platform: "hacker-news", category: "dev", kind: "hn", lang: "en", limit: 4,
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI&numericFilters=points%3E15&hitsPerPage=8" },
  { id: "aitimes", platform: "aitimes", category: "industry", kind: "rss", lang: "ko", tz: "+09:00", limit: 6,
    url: "https://www.aitimes.com/rss/allArticle.xml" },
  { id: "verge", platform: "the-verge-ai", category: "industry", kind: "rss", lang: "en", limit: 4, maxText: 45_000,
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "techcrunch", platform: "techcrunch-ai", category: "industry", kind: "rss", lang: "en", limit: 4,
    url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
];

export const FETCH_TIMEOUT_MS = 3000;
export const MAX_TEXT = 16_000;
export const FRESH_WINDOW_MS = 6 * 3_600_000;
export const EDGE_TTL_MS = 36 * 3_600_000;
export const EDGE_CAP = 40;
export const MAX_NEW_PER_RUN = 10;
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const GEMINI_TIMEOUT_MS = 45_000;

export interface RawEntry {
  source: EdgeSource;
  title: string;
  link: string;
  published: number | null;
  description: string;
  publisher: string | null;
}

const AI_RE = /(\bA\.?I\b|인공지능|LLM|GPT|에이전트|agent|Claude|Gemini|OpenAI|Anthropic|머신러닝|딥러닝|생성형|챗봇|Llama|Qwen|DeepSeek|MCP)/i;

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

export function parseFeed(text: string, source: EdgeSource): RawEntry[] {
  const body = text.slice(0, source.maxText ?? MAX_TEXT);
  if (source.kind === "hn") {
    try {
      const hits = (JSON.parse(body) as { hits?: Array<Record<string, unknown>> }).hits ?? [];
      return hits.slice(0, source.limit).map((h) => ({
        source,
        title: String(h.title ?? "").trim(),
        link: typeof h.url === "string" && h.url ? h.url : `https://news.ycombinator.com/item?id=${h.objectID}`,
        published: typeof h.created_at === "string" ? Date.parse(h.created_at) : null,
        description: "",
        publisher: null,
      }));
    } catch {
      return [];
    }
  }
  const out: RawEntry[] = [];
  const parts = body.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const block of parts) {
    if (out.length >= source.limit) break;
    const rawTitle = tag(block, "title");
    let link = tag(block, "link")?.trim() ?? "";
    if (!link) link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    if (!rawTitle || !link.startsWith("https://")) continue;
    const publisher = tag(block, "source");
    let title = stripTags(rawTitle);
    if (publisher) {
      const pub = stripTags(publisher);
      if (title.endsWith(` - ${pub}`)) title = title.slice(0, -(pub.length + 3)).trim();
    }
    const description = stripTags(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "").slice(0, 400);
    if (source.aiOnly && !AI_RE.test(`${title} ${description}`)) continue;
    out.push({
      source,
      title,
      link: decode(link),
      published: parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date"), source.tz),
      description,
      publisher: publisher ? stripTags(publisher) : null,
    });
  }
  return out;
}

async function fetchText(source: EdgeSource, fetchImpl: typeof fetch): Promise<{ text: string | null; status: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(source.url, {
      signal: ctrl.signal,
      headers: {
                "User-Agent": "Mozilla/5.0 (compatible; AI-Radar-Edge/1.0)",
        "Accept-Language": source.lang === "ko" ? "ko-KR,ko;q=0.9" : "en-US,en;q=0.9",
        Accept: "application/rss+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) return { text: null, status: String(res.status) };
    return { text: await res.text(), status: "200" };
  } catch (e) {
    return { text: null, status: (e as Error)?.name === "AbortError" ? "timeout" : "error" };
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
export interface Edited {
  title_ko: string;
  summary: string;
  vision: string | null;
}

const PROMPT = `너는 AI 뉴스를 처음 보는 사람에게 설명하는 한국어 뉴스 에디터야. 아래 기사마다 원문(title, description)에 있는 사실만으로 써 줘.
숫자·이름을 지어내지 말고, 일본어 가나·중국어 한자는 쓰지 마(고유명사는 영문 또는 한글).
- title_ko: 자연스러운 한국어 헤드라인 18~45자, 친근한 대화체(~했어요/~나왔어요/~예요/궁금증 ?), 말머리([ ]) 금지
- summary: 초보자용 쉬운 대화체 2문장, 둘 다 '~요.'로 끝. 제목 반복·'쉽게 말해'·번역투 금지
- vision: 2문장. '앞으로 ~'로 시작해 이 변화로 일상·업무에서 무엇이 가능해지는지 + '우리는 ~에 주목해 볼 수 있어요.'
JSON 배열만 출력: [{"i":0,"title_ko":"...","summary":"...","vision":"..."}]
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

export async function geminiEdit(entries: RawEntry[], key: string, fetchImpl: typeof fetch): Promise<{ edits: Map<number, Edited>; calls: number; model: string | null }> {
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
      for (const r of rows) {
        const idx = r.i;
        if (typeof idx === "number" && validEdit(r)) {
          const vision = typeof r.vision === "string" && r.vision.startsWith("앞으로") && !CJK_FOREIGN.test(r.vision) ? r.vision.trim() : null;
          edits.set(idx, { title_ko: r.title_ko.trim(), summary: r.summary.trim(), vision });
        }
      }
      return { edits, calls, model };
    } catch {
      continue;
    } finally {
      clearTimeout(t);
    }
  }
  return { edits: new Map(), calls, model: null };
}

// ── 아이템 조립 ─────────────────────────────────────────────────────────
async function shortHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildEdgeItem(e: RawEntry, edit: Edited | null, nowIso: string): Promise<Record<string, unknown> | null> {
  const title = edit?.title_ko ?? (e.source.lang === "ko" ? e.title : null);
  const summary = edit?.summary ?? (e.source.lang === "ko" ? ruleSummary(e) : null);
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
  };
}

export interface ScanReport {
  fetched: number;
  failed_sources: string[];
  candidates: number;
  fresh_new: number;
  published: number;
  deferred: number;
  gemini_calls: number;
  gemini_model: string | null;
  subrequests: number;
  d1_queries: number;
  rows_read: number;
  rows_written: number;
}

/** 5분 크론 본체 */
export async function runEdgeScan(env: EdgeEnv, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ScanReport> {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const [rows, ...fetched] = await Promise.all([
    readRows(env.DB, ["meta", "edge", "seen"]),
    ...EDGE_SOURCES.map((s) => fetchText(s, fetchImpl)),
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

  const entries = texts.flatMap((t, i) => (t ? parseFeed(t, EDGE_SOURCES[i]) : []));
  const fresh = entries.filter((e) => (e.published === null || nowMs - e.published <= FRESH_WINDOW_MS) && !isSeen(e));
  const uniq = Array.from(new Map(fresh.map((e) => [urlKey(e.link), e])).values())
    .sort((a, b) => (b.published ?? nowMs) - (a.published ?? nowMs))
    .slice(0, MAX_NEW_PER_RUN);

  let gem = { edits: new Map<number, Edited>(), calls: 0, model: null as string | null };
  if (uniq.length > 0 && env.GEMINI_API_KEY) gem = await geminiEdit(uniq, env.GEMINI_API_KEY, fetchImpl);

  const built: Record<string, unknown>[] = [];
  let deferred = 0;
  for (let i = 0; i < uniq.length; i++) {
    const item = await buildEdgeItem(uniq[i], gem.edits.get(i) ?? null, nowIso);
    if (item) {
      built.push(item);
      seen.add(urlKey(uniq[i].link));
      if (titleKey(uniq[i].title)) seen.add(titleKey(uniq[i].title));
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
  const statements = built.length > 0 || deferred > 0
    ? [upsert(env.DB, "edge", JSON.stringify(edge), nowIso), upsert(env.DB, "seen", JSON.stringify(Array.from(seen).slice(-SEEN_CAP)), nowIso), upsert(env.DB, "meta", JSON.stringify(meta), nowIso)]
    : [upsert(env.DB, "meta", JSON.stringify(meta), nowIso)];
  await env.DB.batch(statements);
  resetMemo();
  return {
    fetched: texts.filter(Boolean).length,
    failed_sources: EDGE_SOURCES.flatMap((s, i) => (texts[i] ? [] : [`${s.id}:${fetched[i].status}`])),
    candidates: entries.length,
    fresh_new: uniq.length,
    published: built.length,
    deferred,
    gemini_calls: gem.calls,
    gemini_model: gem.model,
    subrequests: EDGE_SOURCES.length + gem.calls + 2,
    d1_queries: 2,
    rows_read: rowsRead,
    rows_written: statements.length,
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
