import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/v4";

import { SAMPLE_EASY_ORIGINAL } from "@/data/sample-easy-original";
import { SAMPLE_FEED } from "@/data/sample-feed";

import { getSupabaseEnv } from "./data";
import { buildEasyOriginalUserMessage, EASY_ORIGINAL_PROMPT_VERSION, EASY_ORIGINAL_SYSTEM } from "./easy-original-prompt";
import type { EasyOriginal, EasyOriginalResponse } from "./types";

/**
 * [원본 쉽게 읽기] — 비용 절감형 On-Demand 생성 + DB 영구 캐싱
 *
 * 샘플 모드(Supabase 환경변수 없음): 로컬 샘플 해설을 돌려준다.
 * DB 모드:
 *   1) summaries.easy_original_json 이 있으면 즉시 반환 (LLM 호출 0회)
 *   2) 없으면 → 원문 가져오기 → Claude 1회 호출로 해설 생성 → easy_original_json 에 저장 → 반환
 *      (같은 아이템 동시 요청은 하나의 생성 작업을 공유)
 *   생성에는 서버 전용 ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY 가 필요. 없으면 'generator_unavailable'.
 */

export const EASY_MODEL = process.env.EASY_ORIGINAL_MODEL?.trim() || "claude-haiku-5-5";
const MAX_SOURCE_CHARS = 40_000;
const MAX_FETCH_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export type EasyResult = { httpStatus: number; body: EasyOriginalResponse };

const unavailable = (httpStatus: number, reason: Extract<EasyOriginalResponse, { status: "unavailable" }>["reason"], message: string): EasyResult => ({
  httpStatus,
  body: { status: "unavailable", reason, message },
});

// ── 결과 검증 (DB 캐시든 LLM 출력이든 화면에 내보내기 전에 모양을 확인) ─────────────
const SectionSchema = z.object({ heading: z.string(), body: z.string(), quote: z.string().nullable() });
const LlmSchema = z.object({
  sections: z.array(SectionSchema),
  watch_points: z.array(z.string()),
  source_note: z.string().nullable(),
});

export function coerceEasyOriginal(value: unknown): EasyOriginal | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sections) || !Array.isArray(v.watch_points)) return null;
  const sections = v.sections
    .map((s) => s as Record<string, unknown>)
    .filter((s) => typeof s?.heading === "string" && typeof s?.body === "string" && s.body.trim().length > 0)
    .map((s) => ({ heading: String(s.heading), body: String(s.body), quote: typeof s.quote === "string" && s.quote.trim() ? s.quote : null }));
  if (sections.length === 0) return null;
  return {
    sections,
    watch_points: v.watch_points.filter((w): w is string => typeof w === "string" && w.trim().length > 0).slice(0, 4),
    source_note: typeof v.source_note === "string" ? v.source_note : null,
    generated_at: typeof v.generated_at === "string" ? v.generated_at : null,
    model: typeof v.model === "string" ? v.model : null,
  };
}

// ── 원문 가져오기 (SSRF 방어: http(s)만, 사설망·로컬 주소 차단, 크기·시간 제한) ──────
const PRIVATE_HOST_RE =
  /^(localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

export function isFetchableUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && !PRIVATE_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 원문 후보 URL. arXiv(abs·pdf·html)와 Hugging Face 논문 페이지는 HTML 전문 페이지를 먼저 시도한다
 * (초록 페이지엔 본문이 없고, PDF 는 텍스트로 읽을 수 없어서).
 */
export function candidateUrls(url: string): string[] {
  const m =
    url.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i) ??
    url.match(/^https?:\/\/(?:www\.)?huggingface\.co\/papers\/(\d{4}\.\d{4,5})/i);
  if (!m) return [url];
  const html = `https://arxiv.org/html/${m[1]}`;
  const abs = `https://arxiv.org/abs/${m[1]}`;
  return [...new Set([html, abs, url])].filter((u) => !/\/pdf\//i.test(u));
}

/** raw_body 를 대체 원문으로 쓰기 위한 최소 분량 */
export const MIN_RAW_BODY_CHARS = 400;
const MIN_EXCERPT_CHARS = 200;

export type SourceKind = "page" | "raw_body" | "excerpt";

/** 원문 페이지 → (막히면) 수집 때 저장한 raw_body → (짧더라도) metrics 발췌 순으로 대체 원문을 고른다 */
export function chooseSourceText(
  fetched: { text: string; truncated: boolean } | null,
  rawBody: string | null | undefined,
  excerpt: string | null | undefined,
): { text: string; truncated: boolean; kind: SourceKind } | null {
  if (fetched?.text.trim()) return { ...fetched, kind: "page" };
  const raw = (rawBody ?? "").trim();
  if (raw.length >= MIN_RAW_BODY_CHARS) return { text: raw.slice(0, MAX_SOURCE_CHARS), truncated: true, kind: "raw_body" };
  const ex = (excerpt ?? "").trim();
  if (ex.length >= MIN_EXCERPT_CHARS) return { text: ex, truncated: true, kind: "excerpt" };
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/h\d|\/li|\/div|\/section|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export async function fetchSourceText(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; truncated: boolean } | null> {
  for (const candidate of candidateUrls(url)) {
    if (!isFetchableUrl(candidate)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(candidate, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": "AI-Radar/0.1 (easy-original reader)", Accept: "text/html,text/plain,*/*;q=0.5" },
      });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/|json|xml/.test(type)) continue;
      const raw = (await res.text()).slice(0, MAX_FETCH_BYTES);
      const text = /html/i.test(type) || /<html|<body/i.test(raw.slice(0, 2000)) ? htmlToText(raw) : raw;
      if (text.trim().length < 200) continue;
      return { text: text.slice(0, MAX_SOURCE_CHARS), truncated: text.length > MAX_SOURCE_CHARS };
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ── LLM 생성 (단 1회 호출) ───────────────────────────────────────────────────────
export async function generateEasyOriginal(
  input: Parameters<typeof buildEasyOriginalUserMessage>[0],
  client: Pick<Anthropic, "messages"> = new Anthropic(),
): Promise<EasyOriginal> {
  const res = await client.messages.parse({
    model: EASY_MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: EASY_ORIGINAL_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildEasyOriginalUserMessage(input) }],
    output_config: { effort: "medium", format: zodOutputFormat(LlmSchema) },
  });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  if (res.stop_reason === "max_tokens") throw new Error("hit max_tokens");
  const coerced = coerceEasyOriginal({
    ...(res.parsed_output ?? {}),
    generated_at: new Date().toISOString(),
    model: `${res.model} · ${EASY_ORIGINAL_PROMPT_VERSION}`,
  });
  if (!coerced) throw new Error("empty easy-original output");
  return coerced;
}

// ── 진입점 ───────────────────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<EasyResult>>();

export interface EasyDeps {
  anon?: SupabaseClient;
  service?: SupabaseClient | null;
  generate?: typeof generateEasyOriginal;
  fetchText?: typeof fetchSourceText;
  hasLlmKey?: boolean;
}

export async function getEasyOriginal(id: string, deps: EasyDeps = {}): Promise<EasyResult> {
  if (!ID_RE.test(id)) return unavailable(400, "not_found", "잘못된 기사 ID예요.");

  const env = getSupabaseEnv();
  if (!env && !deps.anon) return fromSample(id);

  const anon = deps.anon ?? createClient(env!.url, env!.anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon
    .from("items")
    .select("id,original_title,canonical_url,metrics_json,raw_body,summaries!inner(hook_title,easy_original_json)")
    .eq("id", id)
    .maybeSingle();
  if (error) return unavailable(502, "failed", "기사 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data) return unavailable(404, "not_found", "기사를 찾을 수 없어요.");

  const row = data as unknown as {
    original_title: string;
    canonical_url: string;
    metrics_json: Record<string, unknown> | null;
    raw_body?: string | null;
    summaries: { hook_title: string; easy_original_json: unknown } | Array<{ hook_title: string; easy_original_json: unknown }>;
  };
  const summary = Array.isArray(row.summaries) ? row.summaries[0] : row.summaries;
  const cached = coerceEasyOriginal(summary?.easy_original_json);
  if (cached) return { httpStatus: 200, body: { status: "ready", easy_original: cached, cached: true, source: "supabase" } };

  const service = deps.service !== undefined ? deps.service : serviceClient(env);
  const hasLlmKey = deps.hasLlmKey ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (!service || !hasLlmKey) {
    return unavailable(
      503,
      "generator_unavailable",
      "원본 해설 생성기가 아직 연결되지 않았어요. 서버에 ANTHROPIC_API_KEY 와 SUPABASE_SERVICE_ROLE_KEY 를 넣으면 처음 누를 때 자동으로 만들어져요.",
    );
  }

  const running = inflight.get(id);
  if (running) return running;
  const job = (async (): Promise<EasyResult> => {
    try {
      // ① 원문 페이지(arXiv 는 HTML 전문 우선) → ② 403/429 등으로 막히면 수집 때 저장한 raw_body → ③ 짧은 발췌
      const fetched = await (deps.fetchText ?? fetchSourceText)(row.canonical_url);
      const excerpt = typeof row.metrics_json?._excerpt === "string" ? row.metrics_json._excerpt : "";
      const source = chooseSourceText(fetched, row.raw_body, excerpt);
      if (!source) return unavailable(422, "failed", "원문을 가져오지 못해서 해설을 만들 수 없었어요. 원문 링크로 직접 확인해 주세요.");

      const easy = await (deps.generate ?? generateEasyOriginal)({
        title: row.original_title,
        url: row.canonical_url,
        hookTitle: summary?.hook_title ?? row.original_title,
        sourceText: source.text,
        truncated: source.truncated,
        sourceKind: source.kind,
      });
      const save = await service.from("summaries").update({ easy_original_json: easy }).eq("item_id", id);
      if (save.error) console.error("[ai-radar] easy_original cache write failed:", save.error.message);
      return { httpStatus: 200, body: { status: "ready", easy_original: easy, cached: false, source: "supabase" } };
    } catch (e) {
      console.error("[ai-radar] easy_original generation failed:", e);
      return unavailable(502, "failed", "원본 해설을 만드는 중에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
  return job;
}

function serviceClient(env: ReturnType<typeof getSupabaseEnv>): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env || !key) return null;
  return createClient(env.url, key, { auth: { persistSession: false } });
}

function fromSample(id: string): EasyResult {
  if (!SAMPLE_FEED.some((i) => i.id === id)) return unavailable(404, "not_found", "기사를 찾을 수 없어요.");
  const easy = SAMPLE_EASY_ORIGINAL[id];
  if (!easy) {
    return unavailable(
      200,
      "not_prepared",
      "이 샘플 기사는 아직 원본 해설을 준비하지 않았어요. 데이터베이스와 AI 키를 연결하면 처음 누를 때 자동으로 만들어져요.",
    );
  }
  return { httpStatus: 200, body: { status: "ready", easy_original: easy, cached: true, source: "sample" } };
}
