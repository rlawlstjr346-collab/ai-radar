"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const FILTERS: PlatformFilter[] = ["all", "live", "free", "open_local"];
const REGION_FILTERS: RegionFilter[] = ["all", ...REGION_ORDER];
const DIR_BATCH = 24;
const regionLabel = (r: RegionFilter) =>
  r === "all" ? "전체" : r === "social" ? REGION_META.social.filter : `${REGION_META[r].flag} ${REGION_META[r].filter}`;

export default function DirectoryView({ platforms, items, category, selectedId, onSelect }: Props) {
  const [trait, setTrait] = useState<PlatformFilter>("all");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [visibleCount, setVisibleCount] = useState(DIR_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => platforms.filter((p) => matchesPlatformFilter(p, trait) && matchesRegion(p, region)),
    [platforms, trait, region],
  );
  const groups = useMemo(() => groupPlatforms(filtered, category), [filtered, category]);
  const totalMatching = useMemo(() => groups.reduce((acc, [, list]) => acc + list.length, 0), [groups]);

  // 필터/카테고리 변경 시 배치 초기화
  useEffect(() => {
    setVisibleCount(DIR_BATCH);
  }, [category, trait, region]);

  // 자동 무한 스크롤 센티넬
  const remaining = totalMatching - visibleCount;
  useEffect(() => {
    if (remaining <= 0) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((v) => Math.min(totalMatching, v + DIR_BATCH));
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [remaining, totalMatching]);

  const countBy = useMemo(
    () =>
      items.reduce<Record<string, number>>((acc, i) => {
        acc[i.platform_id] = (acc[i.platform_id] ?? 0) + 1;
        return acc;
      }, {}),
    [items],
  );
  const inCategory = (p: Platform) => category === "all" || p.category === category;

  // 그룹 단위로 visibleCount 만큼만 순차 절단
  const visibleGroups = useMemo(() => {
    let budget = visibleCount;
    const sliced: Array<[typeof groups[number][0], Platform[], number]> = [];
    for (const [cat, list] of groups) {
      if (budget <= 0) break;
      const take = list.slice(0, budget);
      sliced.push([cat, take, list.length]);
      budget -= take.length;
    }
    return sliced;
  }, [groups, visibleCount]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
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
        {/* 권역 필터 */}
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
      </div>

      {visibleGroups.length === 0 && (
        <p className="newsroom-card px-6 py-12 text-center text-[0.95rem] text-fg-2">
          이 조건에 맞는 플랫폼이 없어요. 필터를 바꿔 보세요.
        </p>
      )}

      {visibleGroups.map(([cat, list, fullCount]) => {
        const meta = CATEGORY_META[cat];
        return (
          <section key={cat} aria-labelledby={`dir-${cat}`} className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5 border-b border-line pb-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden />
              <h2 id={`dir-${cat}`} className="text-[20px] font-bold tracking-[-0.018em] text-fg">
                {meta.label}
              </h2>
              <span className="t-meta tnum">{fullCount}곳</span>
            </div>
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {list.map((p) => {
                const selected = selectedId === p.id;
                return (
                  <li key={p.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      aria-pressed={selected}
                      className={`newsroom-card group relative flex h-full w-full flex-col gap-3.5 p-6 sm:p-7 text-left focus-visible:outline-none focus-visible:ring-2 ${meta.ring} ${
                        selected ? "ring-2 ring-fg" : ""
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <PlatformMark platform={p} fallbackId={p.id} size="md" />
                        <span className="min-w-0 flex-1 truncate text-[18.5px] font-bold tracking-[-0.016em] text-fg">
                          {p.name}
                        </span>
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0 text-fg-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      </span>
                      <span className="text-[15.5px] leading-[1.6] text-fg-2">{p.one_liner_ko}</span>
                      <span className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
                        <StatusBadge status={p.collect_status} />
                        {regionOf(p) !== "global" && (
                          <span className="text-[13.5px] font-medium text-fg-3">
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

      {remaining > 0 && (
        <div ref={sentinelRef} aria-hidden className="flex h-12 items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-3/50" />
        </div>
      )}
    </div>
  );
}
