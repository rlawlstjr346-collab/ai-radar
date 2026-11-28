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

type Rect = { x: number; w: number };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * FLIP 유리 캡슐: 폭은 즉시 맞추고(애니메이션 없음) 이전 위치·폭에서 새 위치로 transform 만 240ms 보간한다.
 * width/left 를 애니메이션하지 않아 레이아웃 재계산 없이 GPU 합성으로만 미끄러진다.
 */
function useFlipPill(target: Rect | null) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<Rect | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!target) {
      prev.current = null;
      return;
    }
    el.style.width = `${target.w}px`;
    el.style.transform = `translateX(${target.x}px)`;
    const from = prev.current;
    if (from && (from.x !== target.x || from.w !== target.w) && !prefersReducedMotion() && typeof el.animate === "function") {
      el.animate(
        [
          { transform: `translateX(${from.x}px) scaleX(${from.w / target.w})` },
          { transform: `translateX(${target.x}px) scaleX(1)` },
        ],
        { duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
      );
    }
    prev.current = target;
  }, [target?.x, target?.w]);
  return ref;
}

/** 스크롤 시 얇은 리퀴드 글래스로 고정되는 가로 카테고리 바 — 프로스티드 트랙 위를 유리 캡슐이 미끄러진다 */
export function CategoryNav({ tab, onTab }: { tab: NewsTab; onTab: (t: NewsTab) => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState<Rect | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const activeRef = useFlipPill(active);
  const hoverRef = useFlipPill(hover);

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
      if (btn) setActive({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(list);
    list.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => ro?.disconnect();
  }, [tab]);

  const onHover = (el: HTMLElement | null) => {
    if (!el || el.dataset.tab === tab) setHover(null);
    else setHover({ x: el.offsetLeft, w: el.offsetWidth });
  };

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="nav-sentinel" />
      <nav className="catnav" data-stuck={stuck} aria-label="소식 분류">
        <div className="wrap">
          <div
            ref={listRef}
            className="catnav-list"
            role="tablist"
            onPointerLeave={() => setHover(null)}
          >
            <span ref={hoverRef} className="catnav-hover" data-visible={hover !== null} aria-hidden="true" />
            <span ref={activeRef} className="catnav-pill" data-ready={active !== null} aria-hidden="true" />
            {NEWS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={tab === t.id}
                onClick={() => {
                  setHover(null);
                  onTab(t.id);
                }}
                onPointerEnter={(e) => e.pointerType === "mouse" && onHover(e.currentTarget)}
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
