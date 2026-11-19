"use client";

import { Activity, Compass, History, LayoutGrid, Radar, type LucideIcon } from "lucide-react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import type { CategoryFilter } from "@/lib/filter";
import type { DataSource } from "@/lib/types";

export type View = "feed" | "past" | "directory";

export interface FilterState {
  view: View;
  category: CategoryFilter;
}

interface Props extends FilterState {
  onView: (v: View) => void;
  onCategory: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
  viewCounts: Record<View, number>;
  source: DataSource;
}

const VIEWS: Array<{ id: View; label: string; short: string; Icon: LucideIcon }> = [
  { id: "feed", label: "오늘의 AI 레이더 피드", short: "라이브", Icon: Activity },
  { id: "past", label: "지난 주요 소식", short: "지난 소식", Icon: History },
  { id: "directory", label: "글로벌 AI 플랫폼 도감", short: "도감", Icon: Compass },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-gray-500">{children}</h2>;
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-white/10 bg-[#111827]">
        <span
          className="radar-sweep absolute inset-0 bg-[conic-gradient(from_0deg,rgba(52,211,153,0.35),transparent_35%)]"
          aria-hidden
        />
        <Radar className="relative h-4 w-4 text-emerald-300" strokeWidth={2} aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-[14px] font-semibold tracking-tight text-white">AI Radar</p>
        <p className="text-[11px] text-gray-500">입문자를 위한 글로벌 AI 소식</p>
      </div>
    </div>
  );
}

export function CategoryChips({
  category,
  onCategory,
  counts,
  layout,
}: {
  category: CategoryFilter;
  onCategory: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
  layout: "list" | "row";
}) {
  const options: Array<{ id: CategoryFilter; label: string; Icon: LucideIcon; text?: string }> = [
    { id: "all", label: "전체", Icon: LayoutGrid },
    ...CATEGORY_ORDER.map((c) => ({ id: c, label: CATEGORY_META[c].label, Icon: CATEGORY_META[c].Icon, text: CATEGORY_META[c].text })),
  ];
  return (
    <div
      role="radiogroup"
      aria-label="카테고리 필터"
      className={layout === "list" ? "flex flex-col gap-px" : "thin-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"}
    >
      {options.map((o) => {
        const active = category === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onCategory(o.id)}
            className={
              layout === "list"
                ? `group flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                    active ? "bg-white/[0.07] text-white" : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                  }`
                : `flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                    active ? "border-white/25 bg-white/[0.08] text-white" : "border-white/[0.08] text-gray-400"
                  }`
            }
          >
            <span className="flex items-center gap-2">
              <o.Icon className={`h-3.5 w-3.5 ${active ? (o.text ?? "text-white") : "text-gray-500 group-hover:text-gray-300"}`} aria-hidden />
              {o.label}
            </span>
            <span className="ml-2 font-mono text-[11px] tabular-nums text-gray-600">{counts[o.id] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ViewTabs({
  view,
  onView,
  compact,
  viewCounts,
}: {
  view: View;
  onView: (v: View) => void;
  compact?: boolean;
  viewCounts?: Record<View, number>;
}) {
  return (
    <div role="tablist" aria-label="보기 전환" className={compact ? "grid grid-cols-3 gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1" : "flex flex-col gap-px"}>
      {VIEWS.map(({ id, label, short, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onView(id)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
              compact ? "justify-center py-2" : ""
            } ${active ? "bg-white/[0.08] text-white" : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"}`}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? "text-emerald-300" : ""}`} aria-hidden />
            <span>{compact ? short : label}</span>
            {!compact && viewCounts && <span className="ml-auto font-mono text-[11px] tabular-nums text-gray-600">{viewCounts[id]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 데스크톱 좌측 사이드바 */
export default function Sidebar(p: Props) {
  return (
    // 하단 여백(pb-20): 개발 모드의 Next.js 배지(좌하단)와 문구가 겹치지 않게
    <nav aria-label="탐색" className="thin-scroll flex h-full flex-col gap-6 overflow-y-auto px-3 pb-20 pt-5">
      <div className="px-1">
        <Logo />
      </div>
      <section className="flex flex-col gap-1.5">
        <SectionLabel>View</SectionLabel>
        <ViewTabs view={p.view} onView={p.onView} viewCounts={p.viewCounts} />
      </section>
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Category</SectionLabel>
        <CategoryChips category={p.category} onCategory={p.onCategory} counts={p.counts} layout="list" />
      </section>
      <div className="mt-auto flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${p.source === "sample" ? "bg-amber-400" : "animate-pulse bg-emerald-400"}`} aria-hidden />
        <p className="text-[11px] leading-relaxed text-gray-500">
          {p.source === "sample" ? "샘플 데이터 모드" : "실시간 데이터 연결됨"} · 매시간 새 소식을 물어와요
        </p>
      </div>
    </nav>
  );
}
