import type { Term } from "./types";

export type Segment = { text: string; term?: Term };

/**
 * 본문을 '일반 텍스트 / 용어' 조각으로 나눈다.
 * - 긴 용어부터 매칭 (예: "MIT 라이선스"가 "MIT"보다 우선)
 * - 같은 용어는 한 블록에서 첫 등장만 밑줄 (읽기 방해 최소화)
 * - 대소문자 구분 없이 매칭하되, 화면엔 원문 표기를 그대로 둔다
 */
export function splitByTerms(text: string, terms: Term[]): Segment[] {
  if (!text) return [];
  const usable = [...terms]
    .filter((t) => t.term && t.term.trim().length > 0)
    .sort((a, b) => b.term.length - a.term.length);
  if (usable.length === 0) return [{ text }];

  const lower = text.toLowerCase();
  const taken: Array<{ start: number; end: number; term: Term }> = [];
  for (const t of usable) {
    const needle = t.term.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      const overlaps = taken.some((r) => idx < r.end && end > r.start);
      if (!overlaps) {
        taken.push({ start: idx, end, term: t });
        break; // 첫 등장만
      }
      from = idx + 1;
    }
  }
  taken.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const r of taken) {
    if (r.start > cursor) out.push({ text: text.slice(cursor, r.start) });
    out.push({ text: text.slice(r.start, r.end), term: r.term });
    cursor = r.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
