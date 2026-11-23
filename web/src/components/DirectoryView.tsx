"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { groupPlatforms, type CategoryFilter } from "@/lib/filter";
import { matchesPlatformFilter, PLATFORM_FILTER_LABEL, type PlatformFilter } from "@/lib/platform-traits";
import { matchesRegion, REGION_META, REGION_ORDER, regionOf, type RegionFilter } from "@/lib/regions";
import type { FeedItem, Platform } from "@/lib/types";

import { PlatformMark, StatusBadge } from "./Badges";
import SegmentedControl from "./SegmentedControl";

interface Props {
  platforms: Platform[];
  items: FeedItem[];
  category: CategoryFilter;
  query?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const FILTERS: PlatformFilter[] = ["all", "live", "free", "open_local"];
const REGION_FILTERS: RegionFilter[] = ["all", ...REGION_ORDER];
const regionLabel = (r: RegionFilter) =>
  r === "all" ? "전체" : r === "social" ? REGION_META.social.filter : `${REGION_META[r].flag} ${REGION_META[r].filter}`;

function matchesPlatformQuery(p: Platform, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.id, p.one_liner_ko, p.why_visit_ko, p.access_note ?? ""].some((s) => s.toLowerCase().includes(q));
}

export default function DirectoryView({ platforms, items, category, query = "", selectedId, onSelect }: Props) {
  const [trait, setTrait] = useState<PlatformFilter>("all");
  const [region, setRegion] = useState<RegionFilter>("all");
  const filtered = platforms.filter(
    (p) => matchesPlatformFilter(p, trait) && matchesRegion(p, region) && matchesPlatformQuery(p, query),
  );
  const groups = groupPlatforms(filtered, category);
  const countBy = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.platform_id] = (acc[i.platform_id] ?? 0) + 1;
    return acc;
  }, {});
  const inCategory = (p: Platform) => (category === "all" || p.category === category) && matchesPlatformQuery(p, query);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3.5">
        {/* 성격별 빠른 필터 (슬라이딩 필) */}
        <SegmentedControl
          role="radiogroup"
          label="플랫폼 성격 필터"
          stretch={false}
          value={trait}
          onChange={setTrait}
          className="max-w-full self-start"
          options={FILTERS.map((f) => ({
            key: f,
            label: PLATFORM_FILTER_LABEL[f],
            count: platforms.filter((p) => inCategory(p) && matchesRegion(p, region) && matchesPlatformFilter(p, f)).length,
          }))}
        />
        {/* 권역 필터: 한국 AI 생태계만 따로 모아보기 등 */}
        <SegmentedControl
          role="radiogroup"
          label="권역 필터"
          stretch={false}
          value={region}
          onChange={setRegion}
          className="max-w-full self-start"
          options={REGION_FILTERS.map((r) => ({
            key: r,
            label: regionLabel(r),
            count: platforms.filter((p) => inCategory(p) && matchesPlatformFilter(p, trait) && matchesRegion(p, r)).length,
          }))}
        />
      </header>

      {groups.length === 0 && (
        <p className="newsroom-card px-6 py-12 text-center text-[0.95rem] text-fg-2">
          이 조건에 맞는 플랫폼이 없어요. 필터나 검색어를 바꿔 보세요.
        </p>
      )}

      {groups.map(([cat, list]) => {
        const meta = CATEGORY_META[cat];
        return (
          <section key={cat} aria-labelledby={`dir-${cat}`} className="flex flex-col gap-4">
            <div className="flex items-baseline gap-2.5 border-b border-line pb-2.5">
              <meta.Icon className="h-[1.05rem] w-[1.05rem] shrink-0 self-center text-fg-2" strokeWidth={2} aria-hidden />
              <h2 id={`dir-${cat}`} className="text-[1.12rem] font-bold tracking-[-0.015em] text-fg">
                {meta.label}
              </h2>
              <span className="t-meta tnum">{list.length}곳</span>
            </div>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => {
                const selected = selectedId === p.id;
                return (
                  <li key={p.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      aria-pressed={selected}
                      className={`newsroom-card group relative flex h-full w-full flex-col gap-3 p-5 text-left focus-visible:outline-none focus-visible:ring-2 ${meta.ring} ${
                        selected ? "ring-2 ring-fg" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <PlatformMark platform={p} fallbackId={p.id} size="md" />
                        <span className="min-w-0 flex-1 truncate text-[1.02rem] font-bold tracking-[-0.014em] text-fg">
                          {p.name}
                        </span>
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0 text-fg-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      </span>
                      <span className="text-[0.9rem] leading-relaxed text-fg-2">{p.one_liner_ko}</span>
                      <span className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
                        <StatusBadge status={p.collect_status} />
                        {regionOf(p) !== "global" && (
                          <span className="text-[0.78rem] font-medium text-fg-3">
                            {REGION_META[regionOf(p)].flag} {REGION_META[regionOf(p)].badge}
                          </span>
                        )}
                        {countBy[p.id] ? <span className="t-meta tnum ml-auto">소식 {countBy[p.id]}건</span> : null}
                      </span>
                    </button>
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
