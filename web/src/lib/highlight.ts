import { splitByTerms } from "./terms";
import type { Term } from "./types";

/**
 * 상세 패널 본문의 '형광펜 밑줄'(Readwise Reader 스타일) 구간 계산.
 *  ① 요약기가 `==핵심 구절==` 로 표시한 곳이 있으면 그것만 (마커는 화면에서 지운다)
 *  ② 표시가 없는 문단은 핵심 수치(%, 배, 달러, 순위, 점수 …)와 작은따옴표로 묶인 짧은 개념 구절을 자동으로 찾는다
 * 어느 쪽이든 문단당 최대 MAX_HIGHLIGHTS 곳, 용어 툴팁(점선 밑줄) 구간과 겹치면 용어가 이긴다.
 */

export const MAX_HIGHLIGHTS = 3;

export type HlRange = { start: number; end: number };
export type HlSegment = { text: string; term?: Term; hl?: boolean };

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

/** TermText 가 그릴 조각들: 용어(점선 툴팁) / 형광펜 / 일반 */
export function highlightSegments(raw: string, terms: Term[], auto = true): HlSegment[] {
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

  const ranges = (marked.length > 0 ? marked.slice(0, MAX_HIGHLIGHTS) : auto ? autoHighlights(text, termRanges) : []).sort(
    (a, b) => a.start - b.start,
  );

  const out: HlSegment[] = [];
  pos = 0;
  for (const seg of termSegs) {
    const segStart = pos;
    const segEnd = pos + seg.text.length;
    pos = segEnd;
    if (seg.term || ranges.length === 0) {
      out.push(seg); // 용어 구간은 점선 툴팁 우선
      continue;
    }
    let cursor = segStart;
    for (const r of ranges) {
      const s = Math.max(r.start, segStart);
      const e = Math.min(r.end, segEnd);
      if (s >= e) continue;
      if (s > cursor) out.push({ text: text.slice(cursor, s) });
      out.push({ text: text.slice(s, e), hl: true });
      cursor = e;
    }
    if (cursor < segEnd) out.push({ text: text.slice(cursor, segEnd) });
  }
  return out;
}
