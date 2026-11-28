/**
 * 억지 한글 음차 복원 — Gemini·번역기가 영문 약어·제품명·숫자를 한글 소리로 풀어 쓴 것을 원형으로 되돌린다.
 *   엠시피 → MCP, 지지유에프 → GGUF, 허깅페이스 → Hugging Face, 이 년 → 2년, 열 배 → 10배, 70퍼센트 → 70%
 * Python worker/pipeline/ko_restore.py 와 같은 표를 쓴다.
 */

/** 긴 것부터 (오픈에이아이 가 에이아이 보다 먼저) */
const TRANSLIT_TABLE: Array<[string, string]> = [
  ["챗지피티", "ChatGPT"], ["오픈에이아이", "OpenAI"], ["허깅페이스", "Hugging Face"], ["깃허브", "GitHub"],
  ["지지유에프", "GGUF"], ["에스디케이", "SDK"], ["에이피아이", "API"], ["엘엘엠", "LLM"], ["엠시피", "MCP"],
  ["알에이지", "RAG"], ["에이지아이", "AGI"], ["브이엘엠", "VLM"], ["브이램", "VRAM"], ["씨엘아이", "CLI"],
  ["엠오이", "MoE"], ["지피유", "GPU"], ["엔피유", "NPU"], ["티피유", "TPU"], ["티티에스", "TTS"], ["오씨알", "OCR"],
  ["아이디이", "IDE"], ["지피티", "GPT"], ["에이아이", "AI"],
];
export const TRANSLIT: ReadonlyArray<readonly [string, string]> = [...TRANSLIT_TABLE].sort((a, b) => b[0].length - a[0].length);

const SINO: Record<string, string> = { 일: "1", 이: "2", 삼: "3", 사: "4", 오: "5", 육: "6", 칠: "7", 팔: "8", 구: "9", 십: "10" };
const NATIVE: Record<string, string> = { 두: "2", 세: "3", 네: "4", 다섯: "5", 열: "10", 백: "100" };
/** 숫자 단위 뒤에 올 수 있는 것: 끝·공백·문장부호 또는 조사·접미사 (‘배터리’·‘년도’ 같은 다른 낱말은 제외) */
const TAIL = String.raw`(?=$|[\s.,!?)~·]|간|째|을|를|이|가|은|는|의|에|만|과|와|로|부터|까지|씩|나|쯤)`;

const SINO_RE = new RegExp(String.raw`(^|[^가-힣0-9])(일|이|삼|사|오|육|칠|팔|구|십) ?(년|개월|주년|퍼센트)${TAIL}`, "g");
const NATIVE_RE = new RegExp(String.raw`(^|[^가-힣0-9])(두|세|네|다섯|열|백) ?(배)${TAIL}`, "g");
const PERCENT_RE = /(\d) ?퍼센트/g;

export function restoreOriginals(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [ko, en] of TRANSLIT) if (out.includes(ko)) out = out.split(ko).join(en);
  out = out.replace(SINO_RE, (_, pre: string, n: string, unit: string) => `${pre}${SINO[n]}${unit === "퍼센트" ? "%" : unit}`);
  out = out.replace(NATIVE_RE, (_, pre: string, n: string, unit: string) => `${pre}${NATIVE[n]}${unit}`);
  out = out.replace(PERCENT_RE, "$1%");
  return out;
}

/** 아이템 안의 화면용 한국어 문자열을 모두 복원 (원문 제목·URL·ID 는 건드리지 않는다) */
const SKIP_KEYS = new Set(["id", "dedup_key", "original_title", "canonical_url", "image_url", "thumbnail_url", "platform_id", "category", "published_at", "fetched_at", "first_seen_at", "created_at", "lifecycle_status", "author_handle"]);

export function restoreItem<T>(value: T, key = ""): T {
  if (typeof value === "string") return (SKIP_KEYS.has(key) || key.endsWith("_url") ? value : restoreOriginals(value)) as T;
  if (Array.isArray(value)) return value.map((v) => restoreItem(v, key)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = restoreItem(v, k);
    return out as T;
  }
  return value;
}
