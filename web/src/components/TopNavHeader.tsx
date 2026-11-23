"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import BrandLogo from "./BrandLogo";
import FontSizeToggle from "./FontSizeToggle";
import type { View } from "./Sidebar";
import ThemeToggle from "./ThemeToggle";

export type TitleLang = "ko" | "en";

interface Props {
  view: View;
  onView: (v: View) => void;
  viewCounts: Record<View, number>;
  query: string;
  onQuery: (v: string) => void;
  resultCount: number;
  lang: TitleLang;
  onLang: (l: TitleLang) => void;
  lastCollectedLabel?: string | null;
  lastCollectedTitle?: string;
}

const MAIN_TABS: Array<{ id: View; label: string }> = [
  { id: "feed", label: "실시간 레이더" },
  { id: "past", label: "지난 주요 소식" },
  { id: "directory", label: "AI 플랫폼 도감" },
];

/**
 * 정통 Apple Newsroom 상단 Sticky Frosted-Glass 네비게이션 바.
 * 좌측: 순수 흑백 S-커브 신문 로고 + AI Radar + 실시간 수집 상태
 * 중앙: 애플 언더라인 스타일 메인 탭 (실시간 레이더 · 지난 주요 소식 · AI 플랫폼 도감)
 * 우측: 검색창 + iOS 가로 글씨 크기 슬라이더(85~200%) + 다크 모드 + 한/영 토글
 */
export default function TopNavHeader({
  view,
  onView,
  viewCounts,
  query,
  onQuery,
  resultCount,
  lang,
  onLang,
  lastCollectedLabel,
  lastCollectedTitle,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="top-glass-nav sticky top-0 z-40 w-full">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-2.5 px-4 py-2.5 sm:px-6 lg:px-8">
        {/* 1행: 로고 + 메인 탭(데스크톱) + 우측 컨트롤 바 */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          {/* 좌측: 로고 + 20분 실시간 상태 */}
          <div className="flex min-w-0 items-center gap-3 overflow-visible">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = "/";
              }}
              aria-label="AI Radar 처음 화면으로 새로고침"
              className="flex shrink-0 items-center gap-2 overflow-visible rounded-lg py-0.5 transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <BrandLogo className="h-[2.1rem] w-[2.35rem] shrink-0 overflow-visible text-brand" />
              <span className="font-editorial whitespace-nowrap text-[1.35rem] leading-[1.15]">AI Radar</span>
            </a>

            <span
              className="hidden items-center gap-1.5 rounded-full bg-elevated/80 px-2.5 py-1 text-[0.76rem] font-medium text-fg-2 xl:inline-flex"
              title={lastCollectedTitle}
            >
              <span className="live-ping" aria-hidden />
              <span>20분 주기</span>
              {lastCollectedLabel && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tnum">{lastCollectedLabel}</span>
                </>
              )}
            </span>
          </div>

          {/* 중앙: 애플 언더라인 스타일 메인 탭 (lg 이상에서 1행 중앙 배치) */}
          <nav aria-label="메인 탐색" role="tablist" className="hidden items-center gap-1 lg:flex">
            {MAIN_TABS.map(({ id, label }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onView(id)}
                  className={`press relative inline-flex items-center gap-1.5 px-3.5 py-2 text-[0.92rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? "font-bold text-fg" : "font-medium text-fg-2 hover:text-fg"
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`tnum rounded-full px-1.5 py-px text-[0.72rem] ${
                      active ? "bg-fg text-canvas" : "bg-elevated text-fg-3"
                    }`}
                  >
                    {viewCounts[id]}
                  </span>
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-3 -bottom-2.5 h-[2px] rounded-full bg-fg"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* 우측 컨트롤 바: 검색 + iOS 글씨 크기 슬라이더 + 다크모드 + 한/영 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 검색창 */}
            <div className="relative w-[160px] sm:w-[200px]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3"
                strokeWidth={2}
                aria-hidden
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onQuery("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="검색..."
                aria-label="소식 검색"
                className="h-8 w-full rounded-full border border-line bg-surface/90 pl-8 pr-8 text-[0.82rem] text-fg placeholder:text-fg-3 transition-colors focus:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => onQuery("")}
                  aria-label="검색어 지우기"
                  title={`${resultCount}건 검색됨 — 지우기`}
                  className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-fg-3 hover:bg-elevated hover:text-fg"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded bg-elevated px-1 text-[0.68rem] text-fg-3 sm:inline">
                  /
                </kbd>
              )}
            </div>

            {/* iOS 가로 글씨 크기 슬라이더 (85% ~ 200%) */}
            <FontSizeToggle compact />

            {/* 한/영 전환 토글 */}
            <div
              role="radiogroup"
              aria-label="제목 언어 전환"
              className="inline-flex h-8 shrink-0 items-center rounded-full border border-line bg-elevated p-0.5"
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
                    className={`press rounded-full px-2 py-0.5 text-[0.76rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active ? "bg-surface text-fg shadow-xs" : "text-fg-3 hover:text-fg"
                    }`}
                  >
                    {code === "ko" ? "한" : "EN"}
                  </button>
                );
              })}
            </div>

            {/* 다크 모드 토글 */}
            <ThemeToggle compact />
          </div>
        </div>

        {/* 모바일·태블릿(<lg) 전용 2행 메인 탭 + 수집 상태 */}
        <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-2 lg:hidden">
          <nav aria-label="모바일 메인 탐색" role="tablist" className="thin-scroll flex items-center gap-1 overflow-x-auto">
            {MAIN_TABS.map(({ id, label }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onView(id)}
                  className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[0.85rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? "bg-fg font-semibold text-canvas" : "text-fg-2 hover:bg-elevated hover:text-fg"
                  }`}
                >
                  <span>{label}</span>
                  <span className={`tnum text-[0.75rem] ${active ? "opacity-80" : "text-fg-3"}`}>{viewCounts[id]}</span>
                </button>
              );
            })}
          </nav>
          {lastCollectedLabel && (
            <span className="tnum hidden shrink-0 items-center gap-1.5 text-[0.76rem] text-fg-3 sm:inline-flex" title={lastCollectedTitle}>
              <span className="live-ping" aria-hidden />
              {lastCollectedLabel}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
