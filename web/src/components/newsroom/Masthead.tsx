"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { NEWS_TABS, type NewsTab } from "@/lib/front-page";

import ThemeToggle from "../ThemeToggle";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M13.2 13.2L17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function Masthead({
  statusLabel,
  query,
  onQuery,
}: {
  statusLabel: string;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <a href="./" className="wordmark" aria-label="AI RADAR 첫 화면">
          AI RADAR
        </a>
        <p className="masthead-status" aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          <span>24H 글로벌 AI 뉴스룸</span>
          <span aria-hidden="true">·</span>
          <span className="tnum">{statusLabel}</span>
        </p>
        <div className="masthead-tools">
          <label className="search">
            <SearchIcon />
            <span className="sr-only">소식 검색</span>
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="모델·회사·키워드 검색"
              enterKeyHint="search"
              autoComplete="off"
            />
          </label>
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}

/** 스크롤 시 얇은 리퀴드 글래스로 고정되는 가로 카테고리 바 (활성 캡슐은 transform 으로만 이동) */
export function CategoryNav({ tab, onTab }: { tab: NewsTab; onTab: (t: NewsTab) => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const btn = list.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (btn) setPill({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(list);
    list.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => ro?.disconnect();
  }, [tab]);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="nav-sentinel" />
      <nav className="catnav" data-stuck={stuck} aria-label="소식 분류">
        <div className="wrap">
          <div ref={listRef} className="catnav-list" role="tablist">
            {pill && (
              <span
                className="catnav-pill"
                aria-hidden="true"
                style={{ transform: `translateX(${pill.x}px) scaleX(${pill.w})` }}
              />
            )}
            {NEWS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={tab === t.id}
                onClick={() => onTab(t.id)}
                className="catnav-tab"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}
