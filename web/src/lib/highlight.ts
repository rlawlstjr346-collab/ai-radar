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
export type EasySegment = { text: string; term?: Term; hl?: boolean; bold?: boolean };

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

// ── 원본 쉽게 읽기 전용: 스마트 볼드(인물·@계정·따옴표 개념어·기업/모델·핵심 수치, 카드당 첫 등장 1회) + 절제된 결론 1문장 형광펜 ──

const EASY_COMPANIES_AND_PLATFORMS: readonly string[] = [
  "Google DeepMind",
  "Apple Intelligence",
  "OpenAI",
  "Anthropic",
  "NVIDIA",
  "Microsoft",
  "Hugging Face",
  "GitHub",
  "Vercel",
  "Cursor",
  "Perplexity",
  "Moonshot AI",
  "Moonshot",
  "Kimi",
  "Zhipu AI",
  "Zhipu",
  "GLM",
  "MiniMax",
  "ByteDance",
  "Alibaba",
  "Tencent",
  "StepFun",
  "ModelScope",
  "QbitAI",
  "Synced",
  "36Kr AI",
  "36Kr",
  "V2EX",
  "Juejin",
  "LangGraph",
  "LangChain",
  "PyTorch",
  "Core ML",
  "MLX",
  "MCP",
  "RAG",
  "Codex",
  "Meta",
  "Google",
  "Apple",
  "xAI",
  "오픈AI",
  "앤트로픽",
  "엔비디아",
  "구글",
  "애플",
  "메타",
  "마이크로소프트",
  "알리바바",
  "바이트댄스",
  "텐센트",
  "허깅페이스",
  "양자위",
  "기기지심",
  "굴진",
];

const EASY_EXTRA_FIGURES: readonly string[] = [
  "트럼프",
  "도널드 트럼프",
  "머스크",
  "올트먼",
  "알트먼",
  "이선 몰릭",
  "네이선 램버트",
  "세바스찬 라슈카",
  "잭 클라크",
  "앤드류 응",
  "리카이푸",
];

const PERSON_TITLE_SUFFIX_RE = /^(?:\s+(?:CEO|CTO|CFO|COO|대표|창업자|공동창업자|교수|연구원|수석|부사장|회장|박사))+/;
const HANDLE_RE = /(?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,20}/g;
const EASY_QUOTED_RE = /(?<![A-Za-z0-9])['‘"“]([^'’"”\n]{2,22})['’"”]/g;
const EASY_METRIC_RE =
  /(?:★\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?[BMK]\b|v\d+\.\d+(?:\.\d+)?|(?:(?:주당|전체|최대|최소|평균|약|하루|매달|매일|연간|월)\s?)?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|퍼센트|배|달러|센트|원(?!래)|위(?![가-힣])|점(?![가-힣])|만\s?(?:명|건|개|원|달러|토큰)|억\s?(?:원|달러|파라미터|개)?|조\s?(?:원|토큰)?|토큰|파라미터|ms|초(?![가-힣])|시간(?![가-힣])|스타))/g;

const CONCLUSION_SCORE_RE =
  /(핵심|요약하면|결론|장점|차이|절감|단축|향상|개선|돌파|공개|출시|활용할\s*수|유용하게|실제로|추천|벤치마킹|자동화|효율|성능|비용|이득|바로)/g;

const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+|(?<=[다요음함]\.)\s+|\n+/g;

/** 원본 쉽게 읽기 02(핵심 내용)·04(실전 적용) 섹션에서 가장 중요한 결론 1문장(또는 핵심 구절) 구간을 고른다. */
export function selectConclusionHighlight(text: string): HlRange | null {
  if (!text || text.trim().length < 20) return null;

  const sentences: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;
  for (const m of text.matchAll(SENTENCE_BOUNDARY_RE)) {
    const idx = m.index ?? 0;
    const raw = text.slice(cursor, idx);
    const trimmed = raw.trim();
    if (trimmed.length >= 16) {
      const leadWs = raw.length - raw.trimStart().length;
      const start = cursor + leadWs;
      sentences.push({ start, end: start + trimmed.length, text: trimmed });
    }
    cursor = idx + m[0].length;
  }
  if (cursor < text.length) {
    const raw = text.slice(cursor);
    const trimmed = raw.trim();
    if (trimmed.length >= 16) {
      const leadWs = raw.length - raw.trimStart().length;
      const start = cursor + leadWs;
      sentences.push({ start, end: start + trimmed.length, text: trimmed });
    }
  }
  if (sentences.length === 0) return null;

  let best = sentences[0];
  let bestScore = -Infinity;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    let score = 0;
    const sigHits = s.text.match(CONCLUSION_SCORE_RE)?.length ?? 0;
    score += sigHits * 2.5;
    if (EASY_METRIC_RE.test(s.text)) {
      EASY_METRIC_RE.lastIndex = 0;
      score += 3.5;
    }
    if (s.text.length >= 24 && s.text.length <= 105) score += 2.0;
    if (i === 0) score += 1.0;
    if (/원문에서는 특히|하단 원문 링크|도표·스크린샷/.test(s.text)) score -= 5.0;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  // 문장이 지나치게 길면(110자 초과) 앞쪽 핵심 절만 깔끔하게 하이라이트
  if (best.text.length > 110) {
    const clause = best.text.slice(0, 105);
    const comma = Math.max(clause.lastIndexOf(", "), clause.lastIndexOf(" — "), clause.lastIndexOf("이며 "));
    const cutLen = comma >= 35 ? comma : clause.lastIndexOf(" ");
    if (cutLen >= 25) {
      return { start: best.start, end: best.start + cutLen };
    }
  }
  return { start: best.start, end: best.end };
}

/** 원본 쉽게 읽기 스마트 볼드 구간: 인물·직함, @계정명, 따옴표 개념어, AI 기업·모델·서비스명, 핵심 수치 (동일 단어 카드당 첫 등장 1회) */
export function easyBoldRanges(
  text: string,
  exclude: HlRange[] = [],
  entities: Entity[] = [],
  max = 12,
): HlRange[] {
  if (!text || max <= 0) return [];

  type Candidate = HlRange & { key: string; priority: number };
  const hits: Candidate[] = [];

  // 1) @계정명
  for (const m of text.matchAll(HANDLE_RE)) {
    const start = m.index ?? 0;
    hits.push({ start, end: start + m[0].length, key: m[0].toLowerCase(), priority: 4 });
  }

  // 2) 핵심 수치 (%, 배수, 토큰, 스타, 파라미터 등)
  for (const m of text.matchAll(EASY_METRIC_RE)) {
    const start = m.index ?? 0;
    hits.push({ start, end: start + m[0].length, key: m[0].toLowerCase().replace(/\s+/g, ""), priority: 3 });
  }

  // 3) 따옴표 핵심 개념어 (안쪽 텍스트만 볼드)
  for (const m of text.matchAll(EASY_QUOTED_RE)) {
    const start = (m.index ?? 0) + 1;
    const inner = m[1];
    hits.push({ start, end: start + inner.length, key: inner.toLowerCase().trim(), priority: 2 });
  }

  // 4) 인물·직함 + 주요 AI 기업·모델·서비스명 + 동적 entities
  const nameMap = new Map<string, { name: string; exactCase: boolean; isPerson: boolean }>();
  for (const f of [...BUILTIN_FIGURES, ...EASY_EXTRA_FIGURES]) {
    nameMap.set(f.toLowerCase(), { name: f, exactCase: false, isPerson: true });
  }
  for (const m of BUILTIN_MODELS) {
    nameMap.set(m.name.toLowerCase(), { name: m.name, exactCase: Boolean(m.exactCase), isPerson: false });
  }
  for (const c of EASY_COMPANIES_AND_PLATFORMS) {
    const key = c.toLowerCase();
    if (!nameMap.has(key)) {
      nameMap.set(key, { name: c, exactCase: ASCII_RE.test(c) && c.length <= 4, isPerson: false });
    }
  }
  for (const e of entities) {
    const name = e?.name?.trim();
    if (!name || name.length < 2) continue;
    const key = name.toLowerCase();
    if (!nameMap.has(key)) {
      nameMap.set(key, {
        name,
        exactCase: ASCII_RE.test(name) && name.length <= 4,
        isPerson: (e.kind ?? "").toLowerCase() === "person",
      });
    }
  }

  const sortedNames = [...nameMap.values()].sort((a, b) => b.name.length - a.name.length);
  for (const { name, exactCase, isPerson } of sortedNames) {
    const isAscii = ASCII_RE.test(name);
    const pattern = isAscii ? `(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])` : escapeRegExp(name);
    const re = new RegExp(pattern, exactCase ? "g" : "gi");
    const m = re.exec(text);
    if (!m) continue;
    let end = m.index + m[0].length;
    if (isPerson) {
      const tail = text.slice(end, end + 20);
      const titleMatch = PERSON_TITLE_SUFFIX_RE.exec(tail);
      if (titleMatch) end += titleMatch[0].length;
    }
    hits.push({ start: m.index, end, key: name.toLowerCase(), priority: isPerson ? 5 : 3 });
  }

  // 긴 구간/높은 우선순위 먼저 겹침 제거 후 본문 순서대로 동일 키 1회만 선택
  hits.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const nonOverlapping: Candidate[] = [];
  for (const h of hits) {
    if (exclude.some((x) => overlaps(x, h))) continue;
    if (nonOverlapping.some((x) => overlaps(x, h))) continue;
    nonOverlapping.push(h);
  }
  nonOverlapping.sort((a, b) => a.start - b.start);

  const seenKeys = new Set<string>();
  const picked: HlRange[] = [];
  for (const h of nonOverlapping) {
    if (picked.length >= max) break;
    if (seenKeys.has(h.key)) continue;
    seenKeys.add(h.key);
    picked.push({ start: h.start, end: h.end });
  }
  return picked;
}

/**
 * 원본 쉽게 읽기 전용 세그먼트 분할기:
 * 1) 용어 툴팁(점선 밑줄)
 * 2) enableMark=true(02 핵심 내용 · 04 실전 적용)일 때 결론 1문장/핵심구절만 웜 앰버 <mark>
 * 3) 인물·직함, @계정명, 따옴표 핵심 개념어, AI 기업·모델·서비스명, 핵심 수치 <strong> (동일 단어 1회만)
 */
export function easyOriginalSegments(
  raw: string,
  terms: Term[],
  entities: Entity[] = [],
  options: { enableMark?: boolean } = {},
): EasySegment[] {
  if (!raw) return [];
  const { text, ranges: explicitMarks } = parseHighlightMarks(raw);
  const termSegs = splitByTerms(text, terms);

  const termRanges: HlRange[] = [];
  let pos = 0;
  for (const seg of termSegs) {
    if (seg.term) termRanges.push({ start: pos, end: pos + seg.text.length });
    pos += seg.text.length;
  }

  const hlRanges: HlRange[] = [];
  if (options.enableMark) {
    const picked = explicitMarks[0] ?? selectConclusionHighlight(text);
    if (picked) hlRanges.push(picked);
  }

  const boldRanges = easyBoldRanges(text, [...termRanges, ...hlRanges], entities);

  type Span = HlRange & { kind: "hl" | "bold" };
  const spans: Span[] = [
    ...hlRanges.map((r): Span => ({ ...r, kind: "hl" })),
    ...boldRanges.map((r): Span => ({ ...r, kind: "bold" })),
  ].sort((a, b) => a.start - b.start);

  const out: EasySegment[] = [];
  pos = 0;
  for (const seg of termSegs) {
    const segStart = pos;
    const segEnd = pos + seg.text.length;
    pos = segEnd;
    if (seg.term || spans.length === 0) {
      out.push(seg);
      continue;
    }
    let cursor = segStart;
    for (const r of spans) {
      const s = Math.max(r.start, segStart);
      const e = Math.min(r.end, segEnd);
      if (s >= e) continue;
      if (s > cursor) out.push({ text: text.slice(cursor, s) });
      out.push(r.kind === "hl" ? { text: text.slice(s, e), hl: true } : { text: text.slice(s, e), bold: true });
      cursor = e;
    }
    if (cursor < segEnd) out.push({ text: text.slice(cursor, segEnd) });
  }
  return out;
}
