"use client";

import { ArrowRight } from "lucide-react";
import type { KeyboardEvent } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { formatDate, freshness } from "@/lib/filter";
import { stripHighlightMarks } from "@/lib/highlight";
import { getHighlightSummary } from "@/lib/reading-insights";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitTakeaway, PlatformMark, QuietTag } from "./Badges";
import type { TitleLang } from "./Sidebar";
import XLogo from "./XLogo";

interface Props {
  item: FeedItem;
  platform?: Platform;
  platformsById: Map<string, Platform>;
  selected: boolean;
  now: number;
  lang?: TitleLang;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onEntity: (name: string) => void;
}

/** X(Twitter) 아이템 판별: platform_id, URL(x.com/twitter.com), author_handle 모두 체크 */
export function isXItem(item: Pick<FeedItem, "platform_id" | "canonical_url" | "author_handle">): boolean {
  return (
    item.platform_id === "x" ||
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(item.canonical_url) ||
    Boolean(item.author_handle)
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

export function visibleEntities(item: FeedItem, platform?: Platform): string[] {
  const skip = new Set([norm(item.platform_id), ...(platform ? [norm(platform.name)] : [])]);
  return [...new Set(item.entities.map((e) => e.name))].filter((n) => !skip.has(norm(n)));
}

/** 카드 제목: 기본 한국어 후킹 제목, EN 모드일 땐 원문 제목 우선 */
function displayHeadline(item: FeedItem, lang: TitleLang = "ko"): string {
  if (lang === "en" && item.original_title?.trim()) return item.original_title.trim();
  return item.hook_title;
}

/** 카드 미리보기: 복붙 템플릿 금지 — 각 기사 고유의 '1분 핵심요약' 첫 문장 사용 */
function uniqueCardPreview(item: FeedItem): string {
  const raw = stripHighlightMarks(getHighlightSummary(item) || item.what_ko || item.context_ko || "").trim();
  if (!raw) return "";
  const m = raw.match(/^.+?[.!?요다](?=\s|$)/);
  return (m ? m[0] : raw).trim();
}

/** 텍스트 드래그 복사 중에는 오작동 클릭을 막고, 카드 어디를 클릭해도 즉시 모달을 연다 */
function makeCardHandlers(id: string, onSelect: (id: string) => void) {
  return {
    onClick: () => {
      if (typeof window !== "undefined" && (window.getSelection()?.toString().length ?? 0) > 0) return;
      onSelect(id);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(id);
      }
    },
  };
}

/**
 * Apple Machine Learning Research 스타일 Eyebrow:
 * `컬러 분야명 | 심볼 + 굵은 출처 플랫폼명 · 상대시간`
 * 중첩 인터랙티브 요소 없이 순수 텍스트·배지로 구성해 카드 박스 어느 지점을 눌러도 즉시 모달이 열린다.
 */
function ResearchEyebrow({
  item,
  platform,
  now,
  tags = false,
}: {
  item: FeedItem;
  platform?: Platform;
  now: number;
  tags?: boolean;
}) {
  const xCard = isXItem(item);
  const catMeta = CATEGORY_META[item.category];
  const platformName = platform?.name ?? item.platform_id;
  const f = item.published_at ? freshness(item.published_at, now) : null;
  const timeIso = item.published_at ?? item.fetched_at ?? item.created_at;
  const timeTitle = new Date(timeIso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const timeLabel = f?.label || `수집 ${formatDate(item.fetched_at ?? item.created_at)}`;

  return (
    <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px]">
      {/* 1. 컬러 분야명 (좌측 컬러 도트와 동일 애플 포인트 컬러) */}
      <span className={`font-semibold tracking-[-0.01em] ${catMeta.text}`}>{catMeta.label}</span>

      <span className="select-none text-fg-3/50" aria-hidden>
        |
      </span>

      {/* 2. 가져온 플랫폼/웹 이름 (선명한 #1D1D1F 굵은 볼드체 + 작은 심볼) */}
      <span className="inline-flex max-w-full items-center gap-1.5 font-bold tracking-[-0.012em] text-fg">
        {xCard ? (
          <>
            <XLogo className="h-4 w-4 shrink-0 text-fg" />
            <span className="truncate">X 실시간{item.author_handle ? ` · ${item.author_handle}` : ""}</span>
          </>
        ) : (
          <>
            <PlatformMark platform={platform} fallbackId={item.platform_id} size="xs" />
            <span className="truncate">{platformName}</span>
          </>
        )}
      </span>

      <span className="select-none text-fg-3/60" aria-hidden>
        ·
      </span>

      {/* 3. 상대시간 */}
      <time dateTime={timeIso} title={timeTitle} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[14.5px] font-medium text-fg-3">
        {f?.fresh && <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />}
        {timeLabel}
      </time>

      {tags && <QuietTags item={item} />}
    </div>
  );
}

function QuietTags({ item }: { item: FeedItem }) {
  return (
    <>
      {item.category === "research" && <QuietTag>논문</QuietTag>}
      {item.source_count > 1 && (
        <QuietTag title={`${item.source_count}곳에서 같은 소식을 포착했어요`}>
          <span className="tnum">{item.source_count}</span>곳 포착
        </QuietTag>
      )}
    </>
  );
}

function EntityLine({ item, platform }: { item: FeedItem; platform?: Platform }) {
  const names = visibleEntities(item, platform).slice(0, 3);
  if (names.length === 0) return null;
  return (
    <p className="t-meta relative z-10 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="text-fg-3">관련</span>
      <span className="text-fg-2">{names.join(" · ")}</span>
    </p>
  );
}

/** ① 상단 대표 후킹 피처드 카드 (전체 박스 클릭 영역 + 비례 확대 패딩) */
export function LeadStory({ item, platform, selected, now, lang = "ko", onSelect }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  const handlers = makeCardHandlers(item.id, onSelect);
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${displayHeadline(item, lang)} — 1분 핵심 요약 열기`}
      data-active={selected ? "true" : "false"}
      {...handlers}
      className={`newsroom-card group relative flex cursor-pointer flex-col gap-4 overflow-hidden p-7 sm:p-9 focus-visible:outline-none focus-visible:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {xCard && <XLogo className="x-watermark" />}
      <ResearchEyebrow item={item} platform={platform} now={now} tags />
      <h2 className="t-lead relative z-10">{displayHeadline(item, lang)}</h2>
      {text && <p className="t-card-summary relative z-10 max-w-[74ch]">{text}</p>}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <BenefitTakeaway tag={item.benefit_tag} />
          <EntityLine item={item} platform={platform} />
        </div>
        <span className="t-meta inline-flex items-center gap-1.5 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </article>
  );
}

/** ② 서브 피처드 카드 (2열 균형 카드 — 전체 박스 클릭 영역) */
export function FeatureStory({ item, platform, selected, now, lang = "ko", onSelect }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  const handlers = makeCardHandlers(item.id, onSelect);
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${displayHeadline(item, lang)} — 1분 핵심 요약 열기`}
      data-active={selected ? "true" : "false"}
      {...handlers}
      className={`newsroom-card group relative flex h-full cursor-pointer flex-col justify-between gap-4 overflow-hidden p-7 sm:p-8 focus-visible:outline-none focus-visible:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {xCard && <XLogo className="x-watermark" />}
      <div className="relative z-10 flex flex-col gap-3">
        <ResearchEyebrow item={item} platform={platform} now={now} tags />
        <h3 className="t-feature">{displayHeadline(item, lang)}</h3>
        {text && <p className="t-card-summary line-clamp-2">{text}</p>}
      </div>
      <div className="relative z-10 flex items-center justify-between gap-2 pt-1">
        <BenefitTakeaway tag={item.benefit_tag} />
        <span className="t-meta ml-auto inline-flex shrink-0 items-center gap-1.5 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </article>
  );
}

/** ③ 정갈하고 큼직한 에디토리얼 피드 카드 (전체 박스 클릭 영역) */
export function StreamRow({ item, platform, selected, now, lang = "ko", onSelect }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  const handlers = makeCardHandlers(item.id, onSelect);
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${displayHeadline(item, lang)} — 1분 핵심 요약 열기`}
      data-active={selected ? "true" : "false"}
      {...handlers}
      className={`newsroom-card group relative flex cursor-pointer flex-col gap-3 overflow-hidden p-7 sm:p-8 focus-visible:outline-none focus-visible:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {xCard && <XLogo className="x-watermark" />}
      <ResearchEyebrow item={item} platform={platform} now={now} tags />
      <h3 className="t-stream relative z-10">{displayHeadline(item, lang)}</h3>
      {text && <p className="t-card-summary relative z-10 line-clamp-2 max-w-[78ch]">{text}</p>}
      <div className="relative z-10 flex items-center justify-between gap-2 pt-1">
        <BenefitTakeaway tag={item.benefit_tag} />
        <span className="t-meta ml-auto inline-flex shrink-0 items-center gap-1.5 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </article>
  );
}

export default function ItemCard(props: Props) {
  return <StreamRow {...props} />;
}

export function SpotlightCard({ rank, ...props }: Props & { rank: number }) {
  return rank === 1 ? <LeadStory {...props} /> : <FeatureStory {...props} />;
}
