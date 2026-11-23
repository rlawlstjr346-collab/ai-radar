"use client";

import { Activity, Compass, History, LayoutGrid, type LucideIcon } from "lucide-react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { formatLastCollected, type CategoryFilter } from "@/lib/filter";
import type { DataSource } from "@/lib/types";

import BrandLogo from "./BrandLogo";
import FontSizeToggle from "./FontSizeToggle";
import SegmentedControl from "./SegmentedControl";
import ThemeToggle from "./ThemeToggle";

/*
 * 사이드바 = 조용한 유틸리티 (DESIGN.md §1-4).
 * 순수 흑백 S-커브 웨이브 신문 심볼 + 클래식 세리프 워드마크, 13.5~14.5px 유동 메뉴, 하단 가+ 글자 크기·테마 스위치.
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
  /** 도감 플랫폼 수 (하단 상태 줄) */
  platformCount?: number;
  /** live-feed.json 마지막 자동 수집 시각(ISO) */
  lastCollectedAt?: string | null;
  /** 현재 기준 시각(ms) */
  now?: number;
}

export function statusLine(source: DataSource, platformCount?: number): string {
  const n = platformCount ? ` · ${platformCount}개 플랫폼${source === "supabase" ? " 연동" : ""}` : "";
  return source === "supabase" ? `글로벌 AI 레이더 가동 중${n}` : `글로벌 AI 레이더${n} · 엄선 에디션`;
}

const VIEWS: Array<{ id: View; label: string; short: string; Icon: LucideIcon }> = [
  { id: "feed", label: "실시간 레이더", short: "실시간", Icon: Activity },
  { id: "past", label: "지난 주요 소식", short: "지난 소식", Icon: History },
  { id: "directory", label: "글로벌 AI 플랫폼 도감", short: "도감", Icon: Compass },
];

const ITEM_BASE =
  "press t-nav flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const itemState = (active: boolean) => (active ? "bg-elevated font-semibold text-fg" : "text-fg-2 hover:bg-elevated hover:text-fg");

/** 로고·제호: 바깥 박스/원 없는 순수 흑백 S-커브 웨이브 신문 심볼(42px) + 고대비 클래식 세리프 워드마크(24px) */
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
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg py-0.5 transition-opacity duration-100 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <BrandLogo className="h-[38px] w-[42px] shrink-0 text-brand" />
      <div className="min-w-0 leading-tight">
        <p className="font-editorial text-[24px] leading-none">AI Radar</p>
        <p className="mt-1 truncate text-[13px] font-medium text-fg-3">실시간 글로벌 AI 뉴스룸</p>
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
      className={layout === "list" ? "flex flex-col gap-0.5" : "thin-scroll -mx-4 flex gap-1 overflow-x-auto px-4 pb-1"}
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
                : `press t-nav flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? "bg-elevated font-semibold text-fg" : "text-fg-2 hover:text-fg"
                  }`
            }
          >
            <span className="flex min-w-0 items-center gap-2.5 truncate">
              {layout === "list" && <o.Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />}
              {o.label}
            </span>
            <span className="ml-2 text-[13px] tabular-nums text-fg-3">{counts[o.id] ?? 0}</span>
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
    <div role="tablist" aria-label="보기 전환" className="flex flex-col gap-0.5">
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
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 truncate">{label}</span>
            {viewCounts && <span className="ml-auto text-[13px] tabular-nums text-fg-3">{viewCounts[id]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 데스크톱 좌측 사이드바 */
export default function Sidebar(p: Props) {
  const collectedLabel = p.lastCollectedAt && p.now !== undefined ? formatLastCollected(p.lastCollectedAt, p.now) : null;
  const collectedTitle = p.lastCollectedAt
    ? new Date(p.lastCollectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : undefined;
  return (
    <nav aria-label="탐색" className="thin-scroll flex h-full flex-col gap-6 overflow-y-auto px-3.5 pb-14 pt-5">
      <div className="px-0.5">
        <Logo />
      </div>
      <ViewTabs view={p.view} onView={p.onView} viewCounts={p.viewCounts} />
      <section aria-labelledby="sidebar-category" className="flex flex-col gap-1">
        <h2 id="sidebar-category" className="px-2.5 pb-1 text-[13px] font-medium text-fg-3">
          분야
        </h2>
        <CategoryChips category={p.category} onCategory={p.onCategory} counts={p.counts} layout="list" />
      </section>
      <div className="mt-auto flex flex-col gap-3 border-t border-line px-1.5 pt-4">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-[13px] leading-relaxed text-fg-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.source === "sample" ? "bg-accent" : "bg-live"}`} aria-hidden />
            {statusLine(p.source, p.platformCount)}
          </p>
          {collectedLabel && (
            <p className="pl-3.5 text-[13px] tabular-nums text-fg-3" title={collectedTitle}>
              마지막 자동 수집: {collectedLabel}
            </p>
          )}
        </div>
        <FontSizeToggle />
        <ThemeToggle />
      </div>
    </nav>
  );
}
