"use client";

import { CATEGORY_META } from "@/lib/categories";
import { ageHours, formatDate, freshness } from "@/lib/filter";
import { stripHighlightMarks } from "@/lib/highlight";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitTakeaway, PlatformBadge, QuietTag } from "./Badges";
import XLogo from "./XLogo";

/*
 * Apple Newsroom 무채색 에디토리얼 카드:
 * - 모든 카드는 순수 #FFFFFF(다크 #141417) + 미세 헤어라인 보더 + 20px 라운드 + 넉넉한 여백
 * - 컬러 배경 틴트·컬러 보더 0%
 * - 오직 X(Twitter) 카드에만 우하단 대형 반투명 𝕏 배경 워터마크(164px, opacity 0.05 / 다크 0.08)
 */

interface Props {
  item: FeedItem;
  platform?: Platform;
  platformsById: Map<string, Platform>;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onEntity: (name: string) => void;
}

function Freshness({ iso, now }: { iso: string; now: number }) {
  const f = freshness(iso, now);
  if (!f.label) return null;
  const title = new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  if (f.fresh) {
    return (
      <time
        dateTime={iso}
        title={title}
        className="time-pill-fresh inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold tabular-nums"
      >
        <span className="live-ping" aria-hidden />
        <span className="sr-only">방금 들어온 소식, </span>
        {f.label}
      </time>
    );
  }
  const within24h = ageHours(iso, now) < 24;
  return (
    <time
      dateTime={iso}
      title={title}
      className={
        within24h
          ? "time-recent inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium tabular-nums"
          : "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
      }
    >
      {f.label}
    </time>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

export function visibleEntities(item: FeedItem, platform?: Platform): string[] {
  const skip = new Set([norm(item.platform_id), ...(platform ? [norm(platform.name)] : [])]);
  return [...new Set(item.entities.map((e) => e.name))].filter((n) => !skip.has(norm(n)));
}

function EntityLine({ item, platform, onEntity }: { item: FeedItem; platform?: Platform; onEntity: (name: string) => void }) {
  const names = visibleEntities(item, platform).slice(0, 3);
  if (names.length === 0) return null;
  return (
    <p className="t-meta relative z-10 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      <span className="mr-1">관련</span>
      {names.map((n, i) => (
        <span key={n} className="inline-flex min-w-0 items-center">
          {i > 0 && (
            <span className="px-1" aria-hidden>
              ,
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEntity(n);
            }}
            className="max-w-[16rem] truncate rounded px-0.5 text-fg-2 underline decoration-line-strong underline-offset-4 transition-colors duration-100 hover:text-fg hover:decoration-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={`'${n}' 관련 소식 보기`}
          >
            {n}
          </button>
        </span>
      ))}
    </p>
  );
}

function CoverButton({ item, selected, onSelect }: { item: FeedItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      className={`text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {item.hook_title}
    </button>
  );
}

const preview = (item: FeedItem) => {
  const t = item.what_ko ?? item.context_ko;
  return t ? stripHighlightMarks(t) : t;
};

/** 메타 한 줄: 깔끔한 무채색 매체명 + 시간 (+ X 포스트만 표준 𝕏 아이콘·계정명) */
function Meta({
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
  const isX = item.platform_id === "x";
  return (
    <div className="t-meta relative z-10 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      {isX ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectPlatform("x");
          }}
          className="inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1 font-semibold text-fg transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="X 플랫폼 소개 보기"
        >
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-elevated p-0.5 text-fg">
            <XLogo className="h-3.5 w-3.5" />
          </span>
          <span>𝕏 실시간</span>
          {item.author_handle && <span className="font-medium text-fg-2">{item.author_handle}</span>}
        </button>
      ) : (
        <span className="-ml-0.5 min-w-0">
          <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
        </span>
      )}
      <span aria-hidden>·</span>
      {item.published_at ? (
        <Freshness iso={item.published_at} now={now} />
      ) : (
        <time
          dateTime={item.fetched_at ?? item.created_at}
          title={new Date(item.fetched_at ?? item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        >
          수집 {formatDate(item.fetched_at ?? item.created_at)}
        </time>
      )}
      {tags && <QuietTags item={item} />}
    </div>
  );
}

function QuietTags({ item }: { item: FeedItem }) {
  return (
    <>
      {item.easy_original_ready && (
        <QuietTag title="원문 전체를 문단별로 쉽게 풀어 쓴 완독 해설이 있어요">완독해설</QuietTag>
      )}
      {item.category === "research" && <QuietTag>논문</QuietTag>}
      {item.source_count > 1 && (
        <QuietTag title={`${item.source_count}곳에서 같은 소식을 포착했어요`}>
          <span className="tnum">{item.source_count}</span>곳 포착
        </QuietTag>
      )}
    </>
  );
}

/** ① 히어로 리드 스토리 — Apple Newsroom 1면 와이드 화이트 카드 */
export function LeadStory({ item, platform, selected, now, onSelect, onSelectPlatform, onEntity }: Props) {
  const text = preview(item);
  const isX = item.platform_id === "x";
  return (
    <div
      data-active={selected ? "true" : "false"}
      className="newsroom-card relative flex flex-col gap-3.5 overflow-hidden p-6 sm:p-8"
    >
      {isX && <XLogo className="x-watermark" />}
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h2 className="t-lead relative z-10">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h2>
      {text && <p className="t-body relative z-10 line-clamp-3 text-fg-2">{text}</p>}
      <div className="relative z-10">
        <BenefitTakeaway tag={item.benefit_tag} className="text-[15px]" />
      </div>
      <div className="pt-0.5">
        <EntityLine item={item} platform={platform} onEntity={onEntity} />
      </div>
    </div>
  );
}

/** ② 서브 피처드 2열 카드 */
export function FeatureStory({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  const text = preview(item);
  const isX = item.platform_id === "x";
  return (
    <div
      data-active={selected ? "true" : "false"}
      className="newsroom-card relative flex h-full flex-col gap-3 overflow-hidden p-5 sm:p-6"
    >
      {isX && <XLogo className="x-watermark" />}
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} />
      <h3 className="t-feature relative z-10">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      {text && <p className="t-body relative z-10 line-clamp-2 text-fg-2">{text}</p>}
    </div>
  );
}

/** ③ 에디토리얼 아티클 리스트 카드 */
export function StreamRow({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  const text = preview(item);
  const isX = item.platform_id === "x";
  return (
    <div
      data-active={selected ? "true" : "false"}
      className="newsroom-card relative flex flex-col gap-2.5 overflow-hidden px-5 py-5 sm:px-6"
    >
      {isX && <XLogo className="x-watermark" />}
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h3 className="t-stream relative z-10">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      {text && <p className="t-meta relative z-10 line-clamp-2 leading-relaxed text-fg-2">{text}</p>}
      <div className="relative z-10">
        <BenefitTakeaway tag={item.benefit_tag} />
      </div>
    </div>
  );
}

export default function ItemCard(props: Props) {
  return <StreamRow {...props} />;
}

export function SpotlightCard({ rank, ...props }: Props & { rank: number }) {
  return rank === 1 ? <LeadStory {...props} /> : <FeatureStory {...props} />;
}
