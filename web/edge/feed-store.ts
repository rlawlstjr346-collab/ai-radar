import type { D1Database, D1PreparedStatement } from "./cf-types";

/**
 * D1 피드 스냅샷 저장소 — Worker 가 큰 JSON 을 절대 파싱하지 않도록 문자열 조각으로 저장·조립한다.
 * 요청당 D1 쿼리 1~2회, 읽기 1~5행. (Free: 쿼리 50회/호출, 읽기 500만 행/일, 쓰기 10만 행/일)
 */

export interface MetaRow {
  generated_at: string;
  scanned_at: string;
  base_generated_at: string;
  base_chunks: number;
  count: number;
  edge_count: number;
}

export const CHUNK_CHARS = 500_000; // 한글 3바이트 기준으로도 1.5MB < D1 행 한도 2MB
export const MAX_BASE_CHUNKS = 4;
export const SEEN_CAP = 1200;

/** Python pipeline/ingest.py 의 url_key 와 동일한 규칙 */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    const q = host === "news.ycombinator.com" ? u.search : "";
    return `${host}${path}${q}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 매체가 달라도 같은 기사(구글 뉴스 리다이렉트 ↔ 원 매체)를 잡는 제목 키. Python ingest.title_key 와 동일 */
export function titleKey(title: string): string {
  const norm = title.toLowerCase().replace(/\s+-\s+[^-]{1,40}$/, "").replace(/[^0-9a-z\uac00-\ud7a3]/g, "");
  return norm.length >= 8 ? `t:${norm.slice(0, 28)}` : "";
}

export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [""];
}

/** {"version":1, ..., "items": [ ... ]} 텍스트에서 items 배열 안쪽만 잘라낸다 (파싱 없이 indexOf 만) */
export function extractItemsInner(feedText: string): string | null {
  const key = feedText.indexOf('"items"');
  if (key < 0) return null;
  const open = feedText.indexOf("[", key);
  const close = feedText.lastIndexOf("]");
  if (open < 0 || close <= open) return null;
  return feedText.slice(open + 1, close).trim();
}

export function assembleFeed(meta: MetaRow, edgeInner: string, baseInner: string): string {
  const parts = [edgeInner.trim(), baseInner.trim()].filter((p) => p.length > 0);
  return (
    `{"version":1,"generated_at":${JSON.stringify(meta.generated_at)},"scanned_at":${JSON.stringify(meta.scanned_at)},` +
    `"item_count":${meta.count + meta.edge_count},"items":[${parts.join(",")}]}`
  );
}

export function edgeInnerOf(edgeJson: string | null): string {
  if (!edgeJson) return "";
  const t = edgeJson.trim();
  return t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : "";
}

export function laterIso(a: string | null | undefined, b: string | null | undefined): string {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta)) return b ?? "";
  if (Number.isNaN(tb)) return a ?? "";
  return ta >= tb ? a! : b!;
}

export async function readRows(db: D1Database, keys: string[]): Promise<Map<string, string>> {
  const placeholders = keys.map(() => "?").join(",");
  const res = await db.prepare(`SELECT k, v FROM feed WHERE k IN (${placeholders})`).bind(...keys).all<{ k: string; v: string }>();
  return new Map((res.results ?? []).map((r) => [r.k, r.v]));
}

export function parseMeta(raw: string | undefined): MetaRow | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<MetaRow>;
    if (typeof m.generated_at !== "string") return null;
    return {
      generated_at: m.generated_at,
      scanned_at: typeof m.scanned_at === "string" ? m.scanned_at : m.generated_at,
      base_generated_at: typeof m.base_generated_at === "string" ? m.base_generated_at : m.generated_at,
      base_chunks: Number(m.base_chunks) || 0,
      count: Number(m.count) || 0,
      edge_count: Number(m.edge_count) || 0,
    };
  } catch {
    return null;
  }
}

export function upsert(db: D1Database, k: string, v: string, at: string): D1PreparedStatement {
  return db.prepare("INSERT INTO feed (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(k, v, at);
}
