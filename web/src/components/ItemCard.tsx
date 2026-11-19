"use client";

import { Radio, Sparkles } from "lucide-react";

import { CATEGORY_META } from "@/lib/categories";
import { freshness } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryTag, DifficultyBadge, PlatformBadge } from "./Badges";
import Spotlight from "./Spotlight";

interface Props {
  item: FeedItem;
  platform?: Platform;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
}

/** 우상단 상대 시간 배지 — 3시간 이내는 초록 라이브 점 + 고대비 */
function Freshness({ iso, now }: { iso: string; now: number }) {
  const f = freshness(iso, now);
  if (!f.label) return null;
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
        f.fresh ? "bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-400/25" : "text-gray-300"
      }`}
    >
      {f.fresh && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
      {f.label}
    </time>
  );
}

function EntityLine({ item }: { item: FeedItem }) {
  if (item.entities.length === 0) return null;
  return (
    <p className="truncate font-mono text-[11px] text-gray-500">
      {item.entities
        .slice(0, 3)
        .map((e) => e.name)
        .join("  ·  ")}
    </p>
  );
}

/** 카드 전체를 덮는 버튼 (배지 버튼은 z-10 으로 위에 올라와 따로 클릭됨) */
function CoverButton({ item, selected, onSelect, className }: { item: FeedItem; selected: boolean; onSelect: (id: string) => void; className: string }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      className={`text-left after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 ${CATEGORY_META[item.category].ring} ${className}`}
    >
      {item.hook_title}
    </button>
  );
}

export default function ItemCard({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  return (
    <Spotlight rgb={CATEGORY_META[item.category].rgb} selected={selected} className="flex h-full flex-col">
      <div className="relative flex flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
          <span className="ml-auto">
            <Freshness iso={item.created_at} now={now} />
          </span>
        </div>

        {item.benefit_tag && (
          <div>
            <BenefitChip tag={item.benefit_tag} />
          </div>
        )}

        <h3 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-gray-50">
          <CoverButton item={item} selected={selected} onSelect={onSelect} className="" />
        </h3>

        {item.context_ko && <p className="line-clamp-2 text-[13px] leading-relaxed text-gray-400">{item.context_ko}</p>}

        <div className="mt-auto flex flex-col gap-2 border-t border-white/[0.05] pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CategoryTag category={item.category} />
            <DifficultyBadge level={item.difficulty} variant="short" />
            {item.source_count > 1 && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500">
                <Radio className="h-3 w-3" aria-hidden />
                {item.source_count}곳 포착
              </span>
            )}
          </div>
          <EntityLine item={item} />
        </div>
      </div>
    </Spotlight>
  );
}

/** 피드 최상단 1~2개 핫이슈 — 가로형 하이라이트 카드 */
export function SpotlightCard({ item, platform, selected, now, rank, onSelect, onSelectPlatform }: Props & { rank: number }) {
  const meta = CATEGORY_META[item.category];
  return (
    <Spotlight rgb={meta.rgb} selected={selected} className="h-full">
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-56 w-56 -translate-y-1/2 rounded-full opacity-[0.18] blur-3xl"
        style={{ background: `rgb(${meta.rgb})` }}
      />
      <div className="relative flex h-full flex-col gap-4 p-5 sm:flex-row sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gray-300">
              <Sparkles className="h-3 w-3" style={{ color: `rgb(${meta.rgb})` }} aria-hidden />
              Top Spotlight · {String(rank).padStart(2, "0")}
            </span>
            <span className="ml-auto">
              <Freshness iso={item.created_at} now={now} />
            </span>
          </div>
          {item.benefit_tag && (
            <div>
              <BenefitChip tag={item.benefit_tag} size="md" />
            </div>
          )}
          <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.015em] text-white sm:text-[21px]">
            <CoverButton item={item} selected={selected} onSelect={onSelect} className="" />
          </h3>
          {item.context_ko && <p className="line-clamp-3 text-[13.5px] leading-relaxed text-gray-400">{item.context_ko}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
            <CategoryTag category={item.category} />
            <DifficultyBadge level={item.difficulty} variant="short" />
            {item.source_count > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <Radio className="h-3 w-3" aria-hidden />
                {item.source_count}곳 포착
              </span>
            )}
          </div>
          <EntityLine item={item} />
        </div>
        <div
          aria-hidden
          className="hidden w-24 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 sm:flex"
        >
          <meta.Icon className="h-7 w-7" style={{ color: `rgb(${meta.rgb})` }} strokeWidth={1.6} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">#{rank}</span>
        </div>
      </div>
    </Spotlight>
  );
}
