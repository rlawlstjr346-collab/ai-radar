"use client";

import { Sparkles } from "lucide-react";

import { CATEGORY_META } from "@/lib/categories";
import { freshness } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryTag, DifficultyBadge, EasyReadyMark, PlatformBadge, SourceStack } from "./Badges";
import Spotlight from "./Spotlight";

interface Props {
  item: FeedItem;
  platform?: Platform;
  platformsById: Map<string, Platform>;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  /** 엔티티(기술 태그)를 누르면: 같은 이름의 플랫폼이 있으면 프로필, 없으면 그 키워드로 검색 */
  onEntity: (name: string) => void;
}

/** 우상단 상대 시간 배지 — 3시간 이내만 초록 라이브 점(초록은 '신선함' 전용), 그 외엔 고대비 무채색 */
function Freshness({ iso, now }: { iso: string; now: number }) {
  const f = freshness(iso, now);
  if (!f.label) return null;
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
        f.fresh ? "bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-400/25" : "text-zinc-300"
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

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

/** 카드 상단 플랫폼명과 겹치는 엔티티는 뺀다 (예: Hugging Face 카드의 #Hugging Face) */
export function visibleEntities(item: FeedItem, platform?: Platform): string[] {
  const skip = new Set([norm(item.platform_id), ...(platform ? [norm(platform.name)] : [])]);
  return [...new Set(item.entities.map((e) => e.name))].filter((n) => !skip.has(norm(n)));
}

function EntityLine({ item, platform, onEntity }: { item: FeedItem; platform?: Platform; onEntity: (name: string) => void }) {
  const names = visibleEntities(item, platform).slice(0, 3);
  if (names.length === 0) return null;
  return (
    <p className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[11px] text-zinc-500">
      {names.map((n, i) => (
        <span key={n} className="inline-flex min-w-0 items-center">
          {i > 0 && <span className="px-1 text-zinc-700" aria-hidden>·</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEntity(n);
            }}
            className="max-w-[14rem] truncate rounded px-0.5 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            title={`'${n}' 관련 소식 보기`}
          >
            {n}
          </button>
        </span>
      ))}
    </p>
  );
}

/** 카드 전체를 덮는 버튼 (배지·엔티티 버튼은 z-10 으로 위에 올라와 따로 클릭됨) */
function CoverButton({ item, selected, onSelect }: { item: FeedItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      className={`text-left after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {item.hook_title}
    </button>
  );
}

/** 카드 겉면 미리보기: 배경 정의(context) 대신 '무슨 일이 터졌는지'(what) */
const preview = (item: FeedItem) => item.what_ko ?? item.context_ko;

function MetaRow({ item, platformsById }: { item: FeedItem; platformsById: Map<string, Platform> }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <CategoryTag category={item.category} />
      <DifficultyBadge level={item.difficulty} variant="short" />
      {item.easy_original_ready && <EasyReadyMark />}
      <span className="ml-auto">
        <SourceStack platformIds={item.source_platforms} count={item.source_count} platformsById={platformsById} />
      </span>
    </div>
  );
}

export default function ItemCard({ item, platform, platformsById, selected, now, onSelect, onSelectPlatform, onEntity }: Props) {
  const text = preview(item);
  return (
    <Spotlight selected={selected} className="flex h-full flex-col">
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

        <h3 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-[#FAFAFA]">
          <CoverButton item={item} selected={selected} onSelect={onSelect} />
        </h3>

        {text && <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-400">{text}</p>}

        <div className="mt-auto flex flex-col gap-2 border-t border-white/[0.05] pt-3">
          <MetaRow item={item} platformsById={platformsById} />
          <EntityLine item={item} platform={platform} onEntity={onEntity} />
        </div>
      </div>
    </Spotlight>
  );
}

/** 피드 최상단 1~2개 핫이슈 — 가로형 하이라이트 카드. 장식 박스 없이 제목·요약에 면적을 몰아준다 */
export function SpotlightCard({
  item,
  platform,
  platformsById,
  selected,
  now,
  rank,
  onSelect,
  onSelectPlatform,
  onEntity,
}: Props & { rank: number }) {
  const text = preview(item);
  return (
    <Spotlight selected={selected} className="h-full">
      <div className="relative flex h-full min-w-0 flex-col gap-3 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            <Sparkles className="h-3 w-3 text-zinc-300" aria-hidden />
            Top Spotlight · <span className="tnum">{String(rank).padStart(2, "0")}</span>
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
        <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.015em] text-[#FAFAFA] sm:text-[21px]">
          <CoverButton item={item} selected={selected} onSelect={onSelect} />
        </h3>
        {text && <p className="line-clamp-3 text-[13.5px] leading-relaxed text-zinc-400">{text}</p>}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
          <div className="min-w-0 flex-1">
            <MetaRow item={item} platformsById={platformsById} />
          </div>
        </div>
        <EntityLine item={item} platform={platform} onEntity={onEntity} />
      </div>
    </Spotlight>
  );
}
