"use client";

import { Activity, Compass, History, LayoutGrid, type LucideIcon } from "lucide-react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import type { CategoryFilter } from "@/lib/filter";
import type { DataSource } from "@/lib/types";

import BrandLogo from "./BrandLogo";
import SegmentedControl from "./SegmentedControl";
import ThemeToggle from "./ThemeToggle";

/*
 * 사이드바 = 조용한 유틸리티 (DESIGN.md §1-4).
 * 영문 대문자 라벨·컬러 아이콘 없이, 14px 단색 아이콘과 글자 위계만. 하단에 다크/종이 테마 스위치.
 */

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
  { id: "feed", label: "실시간 레이더", short: "실시간", Icon: Activity },
  { id: "past", label: "지난 주요 소식", short: "지난 소식", Icon: History },
  { id: "directory", label: "글로벌 AI 플랫폼 도감", short: "도감", Icon: Compass },
];

const ITEM_BASE =
  "press flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const itemState = (active: boolean) => (active ? "bg-elevated font-medium text-fg" : "text-fg-2 hover:bg-elevated hover:text-fg");

/** 로고·제호: 누르면 루트(/)로 이동하며 새로고침 — 필터·검색·선택이 모두 처음 상태로 */
export function Logo() {
  return (
    // 풀 새로고침이 목적이라 next/link 대신 일반 <a> 를 쓴다
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/"
      onClick={(e) => {
        e.preventDefault();
        window.location.href = "/";
      }}
      aria-label="AI Radar 처음 화면으로 새로고침"
      className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg transition-opacity duration-100 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-elevated">
        <BrandLogo className="h-[17px] w-[17px] text-fg" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-[14px] font-bold tracking-tight text-fg">AI Radar</p>
        <p className="truncate text-[12px] text-fg-3">입문자를 위한 글로벌 AI 소식</p>
      </div>
    </a>
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
  const options: Array<{ id: CategoryFilter; label: string; Icon: LucideIcon }> = [
    { id: "all", label: "전체", Icon: LayoutGrid },
    ...CATEGORY_ORDER.map((c) => ({ id: c, label: CATEGORY_META[c].label, Icon: CATEGORY_META[c].Icon })),
  ];
  return (
    <div
      role="radiogroup"
      aria-label="카테고리 필터"
      className={layout === "list" ? "flex flex-col gap-px" : "thin-scroll -mx-4 flex gap-1 overflow-x-auto px-4 pb-1"}
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
                ? `${ITEM_BASE} justify-between ${itemState(active)}`
                : `press flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? "bg-elevated font-medium text-fg" : "text-fg-2 hover:text-fg"
                  }`
            }
          >
            <span className="flex min-w-0 items-center gap-2.5 truncate">
              {layout === "list" && <o.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />}
              {o.label}
            </span>
            <span className="ml-2 text-[12px] tabular-nums text-fg-3">{counts[o.id] ?? 0}</span>
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
  // 좁은 화면 상단 바: 슬라이딩 필 세그먼트
  if (compact) {
    return (
      <SegmentedControl
        label="보기 전환"
        value={view}
        onChange={onView}
        options={VIEWS.map(({ id, short, Icon }) => ({ key: id, label: short, Icon }))}
      />
    );
  }
  return (
    <div role="tablist" aria-label="보기 전환" className="flex flex-col gap-px">
      {VIEWS.map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onView(id)}
            className={`${ITEM_BASE} ${itemState(active)}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 truncate">{label}</span>
            {viewCounts && <span className="ml-auto text-[12px] tabular-nums text-fg-3">{viewCounts[id]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 데스크톱 좌측 사이드바 */
export default function Sidebar(p: Props) {
  return (
    // 하단 여백(pb-16): 개발 모드의 Next.js 배지(좌하단)와 겹치지 않게
    <nav aria-label="탐색" className="thin-scroll flex h-full flex-col gap-7 overflow-y-auto px-3 pb-16 pt-5">
      <div className="px-1">
        <Logo />
      </div>
      <ViewTabs view={p.view} onView={p.onView} viewCounts={p.viewCounts} />
      <section aria-labelledby="sidebar-category" className="flex flex-col gap-1">
        <h2 id="sidebar-category" className="px-2 pb-1 text-[12.5px] text-fg-3">
          분야
        </h2>
        <CategoryChips category={p.category} onCategory={p.onCategory} counts={p.counts} layout="list" />
      </section>
      <div className="mt-auto flex flex-col gap-3 px-2">
        <p className="flex items-center gap-2 text-[12px] leading-relaxed text-fg-3">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.source === "sample" ? "bg-fg-3" : "bg-live"}`} aria-hidden />
          {p.source === "sample" ? "샘플 데이터 모드" : "실시간 데이터 연결됨"}
        </p>
        <ThemeToggle />
      </div>
    </nav>
  );
}
