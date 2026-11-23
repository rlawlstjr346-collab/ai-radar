"use client";

import { Activity, Compass, History, type LucideIcon } from "lucide-react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { formatLastCollected, type CategoryFilter } from "@/lib/filter";
import type { DataSource } from "@/lib/types";

import BrandLogo from "./BrandLogo";
import ThemeToggle from "./ThemeToggle";

export type View = "feed" | "past" | "directory";
export type TitleLang = "ko" | "en";

export interface FilterState {
  view: View;
  category: CategoryFilter;
}

interface Props extends FilterState {
  onView: (v: View) => void;
  onCategory: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
  viewCounts: Record<View, number>;
  lang: TitleLang;
  onLang: (l: TitleLang) => void;
  source: DataSource;
  platformCount?: number;
  lastCollectedAt?: string | null;
  now?: number;
}

export function statusLine(source: DataSource, platformCount?: number): string {
  const n = platformCount ? ` · ${platformCount}개 플랫폼${source === "supabase" ? " 연동" : ""}` : "";
  return source === "supabase" ? `글로벌 AI 레이더 가동 중${n}` : `글로벌 AI 레이더${n} · 엄선 에디션`;
}

const VIEWS: Array<{ id: View; label: string; short: string; Icon: LucideIcon }> = [
  { id: "feed", label: "실시간 레이더", short: "실시간 레이더", Icon: Activity },
  { id: "past", label: "지난 주요 소식", short: "지난 주요 소식", Icon: History },
  { id: "directory", label: "AI 플랫폼 도감", short: "AI 플랫폼 도감", Icon: Compass },
];

/** Apple News 스타일 흑백 스쿼클 신문 심볼 + 모던 네오 그로테스크 산세리프 AI Radar */
export function Logo({ compact = false }: { compact?: boolean }) {
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
      className="flex min-w-0 cursor-pointer items-center gap-3 overflow-visible rounded-xl py-0.5 transition-opacity duration-100 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <BrandLogo className={`${compact ? "h-[34px] w-[34px]" : "h-[36px] w-[36px]"} shrink-0 text-fg`} />
      <span
        className={`font-sans whitespace-nowrap font-extrabold tracking-[-0.03em] text-fg leading-none ${
          compact ? "text-[20.5px]" : "text-[22px]"
        }`}
      >
        AI Radar
      </span>
    </a>
  );
}

/** 한/영 전환 미니 토글 */
export function LangToggle({ lang, onLang }: { lang: TitleLang; onLang: (l: TitleLang) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="제목 언어 전환"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-elevated p-0.5"
    >
      {(["ko", "en"] as const).map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onLang(code)}
            className={`press rounded-md px-2.5 py-1 text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-surface text-fg shadow-xs" : "text-fg-3 hover:text-fg-2"
            }`}
          >
            {code === "ko" ? "한" : "EN"}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Apple Machine Learning Research 스타일의 '분야' 필터.
 * - 데스크톱: 소제목 '분야' + 1.5px solid #1D1D1F 수평 실선 + 원형 컬러 도트 + 1줄 텍스트
 * - 모바일: 깔끔한 가로 스크롤 컬러 도트 스트립
 */
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
  const options: Array<{ id: CategoryFilter; label: string; dotClass: string }> = [
    { id: "all", label: "전체", dotClass: "bg-fg" },
    ...CATEGORY_ORDER.map((c) => ({
      id: c,
      label: CATEGORY_META[c].label,
      dotClass: CATEGORY_META[c].dotClass,
    })),
  ];

  if (layout === "row") {
    return (
      <div role="radiogroup" aria-label="분야 필터" className="thin-scroll -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1">
        {options.map((o) => {
          const active = category === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onCategory(o.id)}
              className={`press inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-[14.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-elevated font-bold text-fg" : "font-medium text-fg-2 hover:bg-elevated/60 hover:text-fg"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${o.dotClass}`} aria-hidden />
              <span className="whitespace-nowrap">{o.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label="분야 필터" className="flex flex-col gap-1 pt-3">
      {options.map((o) => {
        const active = category === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onCategory(o.id)}
            className={`press group flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-[15.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-elevated/95 font-bold text-fg" : "font-medium text-fg-2 hover:bg-elevated/55 hover:text-fg"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${o.dotClass}`} aria-hidden />
              <span className="truncate">{o.label}</span>
            </span>
            <span className={`tnum shrink-0 text-[13.5px] ${active ? "font-semibold text-fg-2" : "text-fg-3"}`}>
              {counts[o.id] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Apple Podcasts 스타일 핵심 뷰 메뉴 */
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
      <div role="tablist" aria-label="보기 전환" className="thin-scroll flex items-center gap-1.5 overflow-x-auto">
        {VIEWS.map(({ id, short }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onView(id)}
              className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-elevated font-bold text-fg" : "font-medium text-fg-2 hover:text-fg"
              }`}
            >
              <span>{short}</span>
              {viewCounts && <span className="tnum text-[13px] text-fg-3">{viewCounts[id]}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="tablist" aria-label="보기 전환" className="flex flex-col gap-1">
      {VIEWS.map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onView(id)}
            className={`press flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[16px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-elevated font-bold text-fg" : "font-medium text-fg-2 hover:bg-elevated/60 hover:text-fg"
            }`}
          >
            <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-fg" : "text-fg-3"}`} strokeWidth={active ? 2.1 : 1.8} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {viewCounts && (
              <span className={`tnum shrink-0 text-[14px] ${active ? "font-semibold text-fg-2" : "text-fg-3"}`}>
                {viewCounts[id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 모바일(<lg) 반응형 상단 바 */
export function MobileHeader(p: Props) {
  const collectedLabel = p.lastCollectedAt && p.now !== undefined ? formatLastCollected(p.lastCollectedAt, p.now) : null;
  return (
    <header className="top-glass-nav sticky top-0 z-40 flex min-w-0 flex-col gap-2.5 px-4 pb-3 pt-4 md:px-6 lg:hidden">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Logo compact />
        <div className="flex shrink-0 items-center gap-2">
          {collectedLabel && (
            <span className="tnum hidden items-center gap-1.5 pr-1 text-[13.5px] text-fg-3 sm:inline-flex">
              <span className="live-ping" aria-hidden />
              {collectedLabel}
            </span>
          )}
          <LangToggle lang={p.lang} onLang={p.onLang} />
          <ThemeToggle compact />
        </div>
      </div>
      <ViewTabs view={p.view} onView={p.onView} viewCounts={p.viewCounts} compact />
      <CategoryChips category={p.category} onCategory={p.onCategory} counts={p.counts} layout="row" />
    </header>
  );
}

/**
 * 데스크톱 좌측 여백 일체형 컬럼 (width: 276px, sticky, 무배경).
 * Apple News 스쿼클 로고 + Apple Podcasts 핵심 메뉴 + Apple ML Research 컬러 도트 필터.
 */
export default function Sidebar(p: Props) {
  const collectedLabel = p.lastCollectedAt && p.now !== undefined ? formatLastCollected(p.lastCollectedAt, p.now) : null;
  const collectedTitle = p.lastCollectedAt
    ? `마지막 자동 수집: ${new Date(p.lastCollectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)`
    : undefined;

  return (
    <aside className="sticky top-0 flex h-dvh w-[276px] shrink-0 flex-col justify-between overflow-y-auto bg-transparent pb-8 pt-9 thin-scroll">
      <div className="flex flex-col gap-8">
        {/* 1. 좌측 최상단 Apple News 스타일 스쿼클 + 산세리프 로고 */}
        <div className="overflow-visible px-1">
          <Logo />
        </div>

        {/* 2. Apple Podcasts 스타일 핵심 뷰 메뉴 */}
        <nav aria-label="주요 메뉴">
          <ViewTabs view={p.view} onView={p.onView} viewCounts={p.viewCounts} />
        </nav>

        {/* 3. Apple ML Research 스타일 분야 필터 (1.5px 수평 실선 + 원형 컬러 도트) */}
        <section aria-labelledby="sidebar-category" className="px-1">
          <h2 id="sidebar-category" className="border-b-[1.5px] border-fg pb-2.5 text-[15px] font-bold tracking-[-0.01em] text-fg">
            분야
          </h2>
          <CategoryChips category={p.category} onCategory={p.onCategory} counts={p.counts} layout="list" />
        </section>
      </div>

      {/* 4. 하단 미니 유틸: 다크 모드 · 한/영 전환 + 조용한 20분 자동 업데이트 1줄 */}
      <footer className="mt-8 flex flex-col gap-3.5 px-1 pt-4">
        <div className="flex items-center gap-2.5">
          <ThemeToggle compact />
          <LangToggle lang={p.lang} onLang={p.onLang} />
        </div>
        <p className="flex items-center gap-2 text-[13.5px] text-fg-3" title={collectedTitle}>
          <span className="live-ping" aria-hidden />
          <span className="truncate">
            20분 자동 업데이트{collectedLabel ? ` · ${collectedLabel}` : ""}
          </span>
        </p>
      </footer>
    </aside>
  );
}
