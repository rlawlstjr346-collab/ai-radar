"use client";

import { ArrowUpRight, Compass } from "lucide-react";

import { CATEGORY_META } from "@/lib/categories";
import { groupPlatforms, type CategoryFilter } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import { PlatformMark, StatusBadge } from "./Badges";
import Spotlight from "./Spotlight";

interface Props {
  platforms: Platform[];
  items: FeedItem[];
  category: CategoryFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DirectoryView({ platforms, items, category, selectedId, onSelect }: Props) {
  const groups = groupPlatforms(platforms, category);
  const countBy = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.platform_id] = (acc[i.platform_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2.5 text-[26px] font-semibold tracking-[-0.02em] text-white">
          <Compass className="h-6 w-6 text-emerald-300" strokeWidth={1.8} aria-hidden />
          글로벌 AI 플랫폼 도감
        </h1>
        <p className="max-w-2xl text-[14.5px] leading-relaxed text-gray-400">
          한국에선 잘 안 알려졌지만 전 세계 AI 덕후들이 매일 들락거리는 알짜 사이트 {platforms.length}곳이에요. 카드를 누르면 여기가
          어떤 곳인지, 왜 가볼 만한지 알려드릴게요.
        </p>
      </header>

      {groups.map(([cat, list]) => {
        const meta = CATEGORY_META[cat];
        return (
          <section key={cat} aria-labelledby={`dir-${cat}`} className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <meta.Icon className={`h-4 w-4 ${meta.text}`} aria-hidden />
              <h2 id={`dir-${cat}`} className="text-[15px] font-semibold text-white">
                {meta.label}
              </h2>
              <span className="font-mono text-[11px] text-gray-500">{list.length}</span>
              <span className={`h-px flex-1 bg-gradient-to-r ${meta.gradient} opacity-20`} aria-hidden />
            </div>
            <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
              {list.map((p) => {
                const selected = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <Spotlight rgb={meta.rgb} selected={selected} className="h-full">
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        aria-pressed={selected}
                        className={`relative flex h-full w-full flex-col gap-2.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 ${meta.ring} rounded-2xl`}
                      >
                        <span className="flex items-center gap-2.5">
                          <PlatformMark platform={p} fallbackId={p.id} size="md" />
                          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-white">{p.name}</span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-600 transition group-hover/spot:text-gray-300" aria-hidden />
                        </span>
                        <span className="text-[13px] leading-relaxed text-gray-300">{p.one_liner_ko}</span>
                        <span className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                          <StatusBadge status={p.collect_status} />
                          {countBy[p.id] ? <span className="font-mono text-[11px] text-gray-500">{countBy[p.id]} stories</span> : null}
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
