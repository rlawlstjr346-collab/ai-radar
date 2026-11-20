"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { groupPlatforms, type CategoryFilter } from "@/lib/filter";
import { matchesPlatformFilter, PLATFORM_FILTER_LABEL, type PlatformFilter } from "@/lib/platform-traits";
import type { FeedItem, Platform } from "@/lib/types";

import { PlatformMark, StatusBadge } from "./Badges";
import SegmentedControl from "./SegmentedControl";
import Spotlight from "./Spotlight";

interface Props {
  platforms: Platform[];
  items: FeedItem[];
  category: CategoryFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const FILTERS: PlatformFilter[] = ["all", "live", "free", "open_local"];

export default function DirectoryView({ platforms, items, category, selectedId, onSelect }: Props) {
  const [trait, setTrait] = useState<PlatformFilter>("all");
  const filtered = platforms.filter((p) => matchesPlatformFilter(p, trait));
  const groups = groupPlatforms(filtered, category);
  const countBy = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.platform_id] = (acc[i.platform_id] ?? 0) + 1;
    return acc;
  }, {});
  const inCategory = (p: Platform) => category === "all" || p.category === category;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">글로벌 AI 플랫폼 도감</h1>
          <span className="t-meta tnum">{platforms.length}곳</span>
        </div>
        {/* 성격별 빠른 필터 (슬라이딩 필) */}
        <SegmentedControl
          role="radiogroup"
          label="플랫폼 성격 필터"
          stretch={false}
          value={trait}
          onChange={setTrait}
          className="self-start max-w-full"
          options={FILTERS.map((f) => ({
            key: f,
            label: PLATFORM_FILTER_LABEL[f],
            count: platforms.filter((p) => inCategory(p) && matchesPlatformFilter(p, f)).length,
          }))}
        />
      </header>

      {groups.length === 0 && (
        <p className="rounded-2xl bg-surface px-6 py-12 text-center text-[15px] text-fg-2">
          이 조건에 맞는 플랫폼이 없어요. 필터를 바꿔 보세요.
        </p>
      )}

      {groups.map(([cat, list]) => {
        const meta = CATEGORY_META[cat];
        return (
          <section key={cat} aria-labelledby={`dir-${cat}`} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2 border-b border-line pb-2">
              <h2 id={`dir-${cat}`} className="text-[16px] font-semibold text-fg">
                {meta.label}
              </h2>
              <span className="t-meta tnum">{list.length}</span>
            </div>
            <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
              {list.map((p) => {
                const selected = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <Spotlight selected={selected} className="h-full">
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        aria-pressed={selected}
                        className={`relative flex h-full w-full flex-col gap-2.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 ${meta.ring} rounded-xl`}
                      >
                        <span className="flex items-center gap-2.5">
                          <PlatformMark platform={p} fallbackId={p.id} size="md" />
                          <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-fg">{p.name}</span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-3 group-hover/spot:text-fg" strokeWidth={1.8} aria-hidden />
                        </span>
                        <span className="text-[14px] leading-relaxed text-fg-2">{p.one_liner_ko}</span>
                        <span className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                          <StatusBadge status={p.collect_status} />
                          {countBy[p.id] ? (
                            <span className="t-meta tnum">소식 {countBy[p.id]}건</span>
                          ) : null}
                        </span>
                      </button>
                    </Spotlight>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
