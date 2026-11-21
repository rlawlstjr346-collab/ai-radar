import { splitByTerms } from "./terms";
import type { Entity, Term } from "./types";

/**
 * 상세 패널 본문의 '듀얼 하이라이트' 구간 계산.
 *  1) 용어 툴팁(점선 밑줄): 최우선 — 겹치면 용어가 이긴다.
 *  2) 핵심 수치·구절(.hl-mark 민트/틸 형광펜 밑줄):
 *     ① 요약기가 `==핵심 구절==` 로 표시한 곳이 있으면 그것만 (마커는 화면에서 지운다)
 *     ② 표시가 없는 문단은 핵심 수치(%, 배, 달러, 순위, 점수 …)와 작은따옴표로 묶인 짧은 개념 구절을 자동 감지
 *  3) AI 모델명·아키텍처명·주요 인물명(.hl-entity 소프트 인디고 칩):
 *     문단당 동일 고유명사는 첫 등장 1회만, 최대 MAX_ENTITY_CHIPS 곳.
 */

export const MAX_HIGHLIGHTS = 3;
export const MAX_ENTITY_CHIPS = 4;

export type HlRange = { start: number; end: number };
export type HlSegment = { text: string; term?: Term; hl?: boolean; entity?: boolean };

const MARK = /==([^=\n]+?)==/g;

/** `==구절==` 마커를 걷어낸 본문 (카드 미리보기·검색 등 하이라이트를 그리지 않는 곳용) */
export function stripHighlightMarks(text: string): string {
  return text ? text.replace(MARK, "$1") : text;
}

/** 마커를 걷어낸 본문과, 걷어낸 본문 기준의 강조 구간 */
export function parseHighlightMarks(text: string): { text: string; ranges: HlRange[] } {
  const ranges: HlRange[] = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const idx = m.index ?? 0;
    out += text.slice(last, idx);
    ranges.push({ start: out.length, end: out.length + m[1].length });
    out += m[1];
    last = idx + m[0].length;
  }
  out += text.slice(last);
  return { text: out, ranges };
}

// 핵심 수치: (주당·전체·최대·평균 …) + 숫자 + 단위. 단위 없는 맨숫자(예: "Gemini 4")는 잡지 않는다.
const NUMERIC =
  /(?:(?:주당|전체|최대|최소|평균|약|하루|매달|매일|연간|월)\s?)?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|퍼센트|배|달러|센트|원(?!래)|위(?![가-힣])|점(?![가-힣])|만\s?(?:명|건|개|원|달러|토큰)|억\s?(?:원|달러)?|조\s?원|ms|초(?![가-힣])|시간(?![가-힣]))/g;
// 작은따옴표로 묶인 2~22자 개념 구절. 영어 소유격(Google's)과 헷갈리지 않게 앞 글자가 영문·숫자면 제외
const QUOTED = /(?<![A-Za-z0-9])['‘]([^'’\n]{2,22})['’]/g;

// AI 모델·아키텍처명 (대소문자 구분이 필요한 짧은 영문 모델명은 exactCase: true)
const BUILTIN_MODELS: ReadonlyArray<{ name: string; exactCase?: boolean }> = [
  { name: "Gemini 4 Neon" },
  { name: "Gemini 4 Carbon" },
  { name: "Gemini 4 Hydrogen" },
  { name: "Gemini 4 Argon" },
  { name: "Gemini 4" },
  { name: "Gemini 3" },
  { name: "Gemini 2.5" },
  { name: "Gemini" },
  { name: "Neon", exactCase: true },
  { name: "Carbon", exactCase: true },
  { name: "Hydrogen", exactCase: true },
  { name: "Argon", exactCase: true },
  { name: "GPT-6.2" },
  { name: "GPT-6" },
  { name: "GPT-5.2" },
  { name: "GPT-5" },
  { name: "GPT-4o" },
  { name: "GPT-4" },
  { name: "o4-mini", exactCase: true },
  { name: "o3", exactCase: true },
  { name: "Claude Opus" },
  { name: "Claude Sonnet" },
  { name: "Claude Haiku" },
  { name: "Claude Code" },
  { name: "Claude" },
  { name: "Opus", exactCase: true },
  { name: "Sonnet", exactCase: true },
  { name: "Haiku", exactCase: true },
  { name: "Grok 4" },
  { name: "Grok 3" },
  { name: "Grok", exactCase: true },
  { name: "Llama 4" },
  { name: "Llama 3" },
  { name: "Llama" },
  { name: "Qwen3" },
  { name: "Qwen 3" },
  { name: "Qwen2.5" },
  { name: "Qwen" },
  { name: "DeepSeek-R2" },
  { name: "DeepSeek-R1" },
  { name: "DeepSeek-V3" },
  { name: "DeepSeek" },
  { name: "FLUX.2", exactCase: true },
  { name: "FLUX", exactCase: true },
  { name: "Sora", exactCase: true },
  { name: "Kling", exactCase: true },
  { name: "Hailuo", exactCase: true },
  { name: "Veo", exactCase: true },
  { name: "Solar", exactCase: true },
  { name: "EXAONE" },
  { name: "HyperCLOVA X" },
  { name: "vLLM", exactCase: true },
  { name: "Mistral" },
  { name: "Mixtral" },
  { name: "Codestral" },
  { name: "Phi-4" },
  { name: "Gemma", exactCase: true },
  { name: "Command A" },
  { name: "Midjourney" },
  { name: "Suno", exactCase: true },
  { name: "TripoSR" },
  { name: "Ollama" },
  { name: "ComfyUI" },
  { name: "NotebookLM" },
  { name: "AlphaFold" },
  { name: "Devin", exactCase: true },
  { name: "Windsurf", exactCase: true },
  { name: "Manus", exactCase: true },
];

// AI 업계 주요 인물명 (영문 + 한국어 표기)
const BUILTIN_FIGURES: readonly string[] = [
  "Sam Altman",
  "샘 올트먼",
  "Andrej Karpathy",
  "안드레이 카파시",
  "Dario Amodei",
  "다리오 아모데이",
  "Demis Hassabis",
  "데미스 하사비스",
  "Jensen Huang",
  "젠슨 황",
  "Yann LeCun",
  "얀 르쿤",
  "Simon Willison",
  "사이먼 윌리슨",
  "Ilya Sutskever",
  "일리야 수츠케버",
  "Geoffrey Hinton",
  "제프리 힌튼",
  "Fei-Fei Li",
  "페이페이 리",
  "Satya Nadella",
  "사티아 나델라",
  "Sundar Pichai",
  "순다르 피차이",
  "Mark Zuckerberg",
  "마크 저커버그",
  "Elon Musk",
  "일론 머스크",
  "Arthur Mensch",
  "아르튀르 멘슈",
  "Liang Wenfeng",
  "량원펑",
  "Alan Turing",
  "앨런 튜링",
  "Greg Brockman",
  "그렉 브록만",
  "Mira Murati",
  "미라 무라티",
  "Noam Shazeer",
  "노암 샤지어",
  "Jeff Dean",
  "제프 딘",
  "Chris Olah",
  "크리스 올라",
];

const ENTITY_CHIP_KINDS = new Set(["model", "person", "architecture", "tool", "product", "framework", "benchmark"]);
const ASCII_RE = /^[A-Za-z0-9 ._+-]+$/;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const overlaps = (a: HlRange, b: HlRange) => a.start < b.end && b.start < a.end;

/** 마커가 없을 때의 자동 강조 구간 (본문 순서, 겹침 없이 최대 max 곳) */
export function autoHighlights(text: string, exclude: HlRange[] = [], max = MAX_HIGHLIGHTS): HlRange[] {
  const found: HlRange[] = [];
  for (const m of text.matchAll(NUMERIC)) {
    const start = m.index ?? 0;
    found.push({ start, end: start + m[0].length });
  }
  for (const m of text.matchAll(QUOTED)) {
    const start = (m.index ?? 0) + 1; // 따옴표 안쪽만
    found.push({ start, end: start + m[1].length });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const picked: HlRange[] = [];
  for (const r of found) {
    if (picked.length >= max) break;
    if (exclude.some((x) => overlaps(x, r)) || picked.some((x) => overlaps(x, r))) continue;
    picked.push(r);
  }
  return picked;
}

/** AI 모델·아키텍처명·주요 인물명 인디고 칩 구간 (문단 내 동일 고유명사는 첫 등장 1회, 최대 max 곳) */
export function entityHighlights(
  text: string,
  exclude: HlRange[] = [],
  entities: Entity[] = [],
  max = MAX_ENTITY_CHIPS,
): HlRange[] {
  if (!text || max <= 0) return [];

  const candidateMap = new Map<string, { name: string; exactCase: boolean }>();
  for (const m of BUILTIN_MODELS) {
    candidateMap.set(m.name.toLowerCase(), { name: m.name, exactCase: Boolean(m.exactCase) });
  }
  for (const f of BUILTIN_FIGURES) {
    candidateMap.set(f.toLowerCase(), { name: f, exactCase: false });
  }
  for (const e of entities) {
    const name = e?.name?.trim();
    if (!name || name.length < 2) continue;
    // 기사 entities 중 모델·인물·도구·제품 계열 (kind 가 비어 있으면 허용)
    if (e.kind && !ENTITY_CHIP_KINDS.has(e.kind.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (!candidateMap.has(key)) {
      candidateMap.set(key, { name, exactCase: ASCII_RE.test(name) && name.length <= 5 });
    }
  }

  // 긴 이름 우선(예: "Gemini 4 Neon" 이 "Gemini 4" · "Neon" 보다 먼저 매칭)
  const sorted = [...candidateMap.values()].sort((a, b) => b.name.length - a.name.length);
  const hits: Array<HlRange & { key: string }> = [];

  for (const { name, exactCase } of sorted) {
    const isAscii = ASCII_RE.test(name);
    const pattern = isAscii ? `(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])` : escapeRegExp(name);
    const re = new RegExp(pattern, exactCase ? "g" : "gi");
    const m = re.exec(text);
    if (!m) continue;
    const range: HlRange = { start: m.index, end: m.index + m[0].length };
    if (exclude.some((x) => overlaps(x, range))) continue;
    hits.push({ ...range, key: name.toLowerCase() });
  }

  // 긴 이름 우선으로 겹침 제거 후, 본문 등장 순서대로 최대 max 곳 선택
  const deduped: Array<HlRange & { key: string }> = [];
  for (const h of hits) {
    if (deduped.some((d) => overlaps(d, h))) continue;
    deduped.push(h);
  }
  deduped.sort((a, b) => a.start - b.start);

  const seenKeys = new Set<string>();
  const picked: HlRange[] = [];
  for (const h of deduped) {
    if (picked.length >= max) break;
    if (seenKeys.has(h.key)) continue;
    seenKeys.add(h.key);
    picked.push({ start: h.start, end: h.end });
  }
  return picked;
}

/** TermText 가 그릴 조각들: 용어(점선 툴팁) > 형광펜(.hl-mark) > 모델·인물(.hl-entity) > 일반 */
export function highlightSegments(raw: string, terms: Term[], auto = true, entities: Entity[] = []): HlSegment[] {
  if (!raw) return [];
  const { text, ranges: marked } = parseHighlightMarks(raw);
  const termSegs = splitByTerms(text, terms);

  // 용어 구간 (원문 위치)
  const termRanges: HlRange[] = [];
  let pos = 0;
  for (const seg of termSegs) {
    if (seg.term) termRanges.push({ start: pos, end: pos + seg.text.length });
    pos += seg.text.length;
  }

  const hlRanges = (marked.length > 0 ? marked.slice(0, MAX_HIGHLIGHTS) : auto ? autoHighlights(text, termRanges) : []).sort(
    (a, b) => a.start - b.start,
  );
  const entityRanges = auto ? entityHighlights(text, [...termRanges, ...hlRanges], entities) : [];

  type Span = HlRange & { kind: "hl" | "entity" };
  const spans: Span[] = [
    ...hlRanges.map((r): Span => ({ ...r, kind: "hl" })),
    ...entityRanges.map((r): Span => ({ ...r, kind: "entity" })),
  ].sort((a, b) => a.start - b.start);

  const out: HlSegment[] = [];
  pos = 0;
  for (const seg of termSegs) {
    const segStart = pos;
    const segEnd = pos + seg.text.length;
    pos = segEnd;
    if (seg.term || spans.length === 0) {
      out.push(seg); // 용어 구간은 점선 툴팁 우선
      continue;
    }
    let cursor = segStart;
    for (const r of spans) {
      const s = Math.max(r.start, segStart);
      const e = Math.min(r.end, segEnd);
      if (s >= e) continue;
      if (s > cursor) out.push({ text: text.slice(cursor, s) });
      out.push(r.kind === "hl" ? { text: text.slice(s, e), hl: true } : { text: text.slice(s, e), entity: true });
      cursor = e;
    }
    if (cursor < segEnd) out.push({ text: text.slice(cursor, segEnd) });
  }
  return out;
}
