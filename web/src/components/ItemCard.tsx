"use client";

import { ArrowRight } from "lucide-react";

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

function CoverButton({
  item,
  lang = "ko",
  selected,
  onSelect,
}: {
  item: FeedItem;
  lang?: TitleLang;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      className={`text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {displayHeadline(item, lang)}
    </button>
  );
}

/**
 * Apple Machine Learning Research 스타일 Eyebrow:
 * `컬러 분야명 | 심볼 + 굵은 출처 플랫폼명 · 상대시간`
 */
function ResearchEyebrow({
  item,
  platform,
  now,
  onSelectPlatform,
  tags = false,
}: {
  item: FeedItem;
  platform?: Platform;
  now: number;
  onSelectPlatform: (id: string) => void;
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
    <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.86rem]">
      {/* 1. 컬러 분야명 (좌측 컬러 도트와 동일 애플 포인트 컬러) */}
      <span className={`font-semibold tracking-[-0.01em] ${catMeta.text}`}>{catMeta.label}</span>

      <span className="select-none text-fg-3/50" aria-hidden>
        |
      </span>

      {/* 2. 가져온 플랫폼/웹 이름 (선명한 #1D1D1F 굵은 볼드체 + 작은 심볼) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelectPlatform(xCard ? "x" : item.platform_id);
        }}
        className="press inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 font-bold tracking-[-0.012em] text-fg transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`${platformName} 플랫폼 소개 보기`}
      >
        {xCard ? (
          <>
            <XLogo className="h-3.5 w-3.5 shrink-0 text-fg" />
            <span className="truncate">𝕏 실시간{item.author_handle ? ` · ${item.author_handle}` : ""}</span>
          </>
        ) : (
          <>
            <PlatformMark platform={platform} fallbackId={item.platform_id} size="xs" />
            <span className="truncate">{platformName}</span>
          </>
        )}
      </button>

      <span className="select-none text-fg-3/60" aria-hidden>
        ·
      </span>

      {/* 3. 상대시간 (#86868B / text-fg-3) */}
      <time dateTime={timeIso} title={timeTitle} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.83rem] font-medium text-fg-3">
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

function EntityLine({ item, platform, onEntity }: { item: FeedItem; platform?: Platform; onEntity: (name: string) => void }) {
  const names = visibleEntities(item, platform).slice(0, 3);
  if (names.length === 0) return null;
  return (
    <p className="t-meta relative z-10 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      <span className="mr-1">관련</span>
      {names.map((n, i) => (
        <span key={n} className="inline-flex min-w-0 items-center">
          {i > 0 && <span className="px-1" aria-hidden>,</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEntity(n);
            }}
            className="max-w-[16rem] truncate rounded px-0.5 text-fg-2 underline decoration-line-strong underline-offset-4 transition-colors duration-100 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {n}
          </button>
        </span>
      ))}
    </p>
  );
}

/** ① 상단 대표 후킹 피처드 카드 (Apple Newsroom 둥근 20px 카드 마감) */
export function LeadStory({ item, platform, selected, now, lang = "ko", onSelect, onSelectPlatform, onEntity }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  return (
    <article
      data-active={selected ? "true" : "false"}
      className="newsroom-card group relative flex flex-col gap-3.5 overflow-hidden p-6 sm:p-8"
    >
      {xCard && <XLogo className="x-watermark" />}
      <ResearchEyebrow item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h2 className="t-lead relative z-10">
        <CoverButton item={item} lang={lang} selected={selected} onSelect={onSelect} />
      </h2>
      {text && <p className="t-body relative z-10 max-w-[70ch] text-fg-2">{text}</p>}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <BenefitTakeaway tag={item.benefit_tag} />
          <EntityLine item={item} platform={platform} onEntity={onEntity} />
        </div>
        <span className="t-meta inline-flex items-center gap-1 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </article>
  );
}

/** ② 서브 피처드 카드 (2열 균형 카드) */
export function FeatureStory({ item, platform, selected, now, lang = "ko", onSelect, onSelectPlatform }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  return (
    <article
      data-active={selected ? "true" : "false"}
      className="newsroom-card group relative flex h-full flex-col justify-between gap-3.5 overflow-hidden p-6"
    >
      {xCard && <XLogo className="x-watermark" />}
      <div className="relative z-10 flex flex-col gap-2.5">
        <ResearchEyebrow item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
        <h3 className="t-feature">
          <CoverButton item={item} lang={lang} selected={selected} onSelect={onSelect} />
        </h3>
        {text && <p className="line-clamp-2 text-[0.98rem] leading-relaxed text-fg-2">{text}</p>}
      </div>
      <div className="relative z-10 flex items-center justify-between gap-2 pt-1">
        <BenefitTakeaway tag={item.benefit_tag} />
        <span className="t-meta ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </article>
  );
}

/** ③ 정갈하고 큼직한 에디토리얼 피드 카드 (Apple ML Research + Apple Newsroom 20px 마감) */
export function StreamRow({ item, platform, selected, now, lang = "ko", onSelect, onSelectPlatform }: Props) {
  const text = uniqueCardPreview(item);
  const xCard = isXItem(item);
  return (
    <article
      data-active={selected ? "true" : "false"}
      className="newsroom-card group relative flex flex-col gap-2.5 overflow-hidden p-6"
    >
      {xCard && <XLogo className="x-watermark" />}
      <ResearchEyebrow item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h3 className="t-stream relative z-10">
        <CoverButton item={item} lang={lang} selected={selected} onSelect={onSelect} />
      </h3>
      {text && <p className="relative z-10 line-clamp-2 max-w-[74ch] text-[0.98rem] leading-relaxed text-fg-2">{text}</p>}
      <div className="relative z-10 flex items-center justify-between gap-2 pt-1">
        <BenefitTakeaway tag={item.benefit_tag} />
        <span className="t-meta ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-fg-2 transition-transform group-hover:translate-x-0.5">
          1분 요약 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
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
