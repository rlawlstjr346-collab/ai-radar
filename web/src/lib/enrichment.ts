import type { FeedItem, RelatedRef, Term } from "./types";

const HTTPS_RE = /^https:\/\/[^/\s]+\.[^/\s]+/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 워커 정제 단계가 덧붙인 Additive 필드(image_url · easy_summary_ko · vision_ko · 묶음) 안전 파싱 */
export function coerceEnrichment(
  r: Record<string, unknown>,
): Pick<FeedItem, "image_url" | "easy_summary_ko" | "vision_ko" | "cluster_size" | "related_refs" | "glossary"> {
  const image = str(r.image_url);
  const related: RelatedRef[] = Array.isArray(r.related_articles)
    ? (r.related_articles as Array<Record<string, unknown>>)
        .map((x) => ({
          id: str(x?.id) ?? "",
          title_ko: str(x?.title_ko) ?? "",
          platform_id: str(x?.platform_id) ?? "",
          canonical_url: str(x?.canonical_url) ?? "",
          published_at: str(x?.published_at),
        }))
        .filter((x) => x.id && x.title_ko && HTTPS_RE.test(x.canonical_url))
    : [];
  const size = Number(r.cluster_size);
  // live-feed 선택 필드 glossary: [{ term, desc }] → 화면 공용 Term { term, easy }
  const glossary: Term[] = Array.isArray(r.glossary)
    ? (r.glossary as Array<Record<string, unknown>>)
        .map((g) => ({ term: str(g?.term) ?? "", easy: str(g?.desc) ?? str(g?.easy) ?? "" }))
        .filter((g) => g.term.length > 0 && g.term.length <= 40 && g.easy.length > 0)
        .slice(0, 4)
    : [];
  return {
    image_url: image && HTTPS_RE.test(image) ? image : null,
    easy_summary_ko: typeof r.easy_summary_ko === "string" ? r.easy_summary_ko.replace(/==/g, "").trim() : null,
    vision_ko: str(r.vision_ko)?.replace(/==/g, "") ?? null,
    cluster_size: Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1,
    related_refs: related,
    ...(glossary.length > 0 ? { glossary } : {}),
  };
}
