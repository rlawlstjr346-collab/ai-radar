"use client";

import { ChevronDown, Search, Telescope, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CATEGORY_ORDER } from "@/lib/categories";
import {
  editorialLayout,
  editorialOrder,
  formatLastCollected,
  hotFeed,
  HOT_LIMIT,
  matchesQuery,
  PAGE_SIZE,
  pastFeed,
  type CategoryFilter,
} from "@/lib/filter";
import type { FeedItem, Platform, RadarData } from "@/lib/types";

import { LiquidGlassModal, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import FontSizeToggle from "./FontSizeToggle";
import { FeatureStory, LeadStory, StreamRow } from "./ItemCard";
import Sidebar, { CategoryChips, Logo, ViewTabs, type View } from "./Sidebar";
import ThemeToggle from "./ThemeToggle";

const CLOCK_TICK_MS = 60_000;

/** 기준 시각: 첫 렌더는 서버가 데이터를 만든 시각(hydration 일치), 이후 1분마다 현재 시각으로 */
function useNow(initialIso: string): number {
  const [now, setNow] = useState(() => Date.parse(initialIso));
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

function FeedHeader({
  view,
  total,
  lastCollectedLabel,
  children,
}: {
  view: "feed" | "past";
  total: number;
  lastCollectedLabel?: string | null;
  children: React.ReactNode;
}) {
  const isFeed = view === "feed";
  return (
    <header className="flex min-w-0 flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:gap-6">
      <div className="flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[calc(clamp(22px,1.35vw+5px,28px)*var(--font-scale,1))] font-bold tracking-[-0.022em] text-fg">
          {isFeed ? "실시간 레이더" : "지난 주요 소식"}
        </h1>
        <span className="t-meta inline-flex items-center gap-1.5">
          {isFeed ? (
            <>
              <span className="live-ping" aria-hidden />
              <span>Live · 20분 자동 스캔</span>
            </>
          ) : (
            <span>8~30일 전 · 중요도 순</span>
          )}
          <span aria-hidden>·</span>
          <span className="tnum">{total}건</span>
          {isFeed && lastCollectedLabel && (
            <span className="inline-flex items-center gap-1.5 lg:hidden">
              <span aria-hidden>·</span>
              <span className="tnum">마지막 자동 수집: {lastCollectedLabel}</span>
            </span>
          )}
        </span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </header>
  );
}

/** 실시간 키워드 검색 — '/' 로 포커스, Esc 로 지우기 */
function SearchBox({ value, onChange, total }: { value: string; onChange: (v: string) => void; total: number }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" strokeWidth={1.8} aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="제목·요약·기술 태그 검색 (예: 무료, 로컬, Gemini)"
        aria-label="소식 검색"
        className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-24 text-[14.5px] text-fg placeholder:text-fg-3 transition-colors duration-100 hover:border-line-strong focus:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {value ? (
          <>
            <span className="tnum text-[12.5px] text-fg-3" aria-live="polite">
              {total}건
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="검색어 지우기"
              className="grid h-6 w-6 place-items-center rounded-md text-fg-3 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <kbd className="hidden rounded bg-elevated px-1.5 py-px text-[11.5px] text-fg-3 sm:inline">/</kbd>
        )}
      </div>
    </div>
  );
}

/** ?item=… / ?platform=… ↔ 선택 상태 */
function readSelectionFromUrl(): Selection {
  const params = new URLSearchParams(window.location.search);
  const item = params.get("item");
  if (item) return { type: "item", id: item };
  const platform = params.get("platform");
  if (platform) return { type: "platform", id: platform };
  return null;
}

function writeSelectionToUrl(sel: Selection) {
  const url = new URL(window.location.href);
  url.searchParams.delete("item");
  url.searchParams.delete("platform");
  if (sel) url.searchParams.set(sel.type, sel.id);
  if (url.href !== window.location.href) window.history.pushState(null, "", url);
}

function EmptyFeed({ allCount, onShowAll }: { allCount: number; onShowAll?: () => void }) {
  return (
    <div className="newsroom-card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Telescope className="h-5 w-5 text-fg-3" strokeWidth={1.8} aria-hidden />
      {onShowAll && allCount > 0 ? (
        <>
          <p className="text-[15px] leading-relaxed text-fg-2">
            선택한 분야에는 없지만 전체 피드에 <span className="tnum font-semibold text-fg">{allCount}</span>건이 있어요.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="press rounded-xl bg-fg px-4 py-2 text-[14px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            전체에서 보기
          </button>
        </>
      ) : (
        <p className="text-[15px] leading-relaxed text-fg-2">이 조건에 맞는 소식이 아직 없어요. 검색어나 필터를 바꿔보시겠어요?</p>
      )}
    </div>
  );
}

function FeedList({
  items,
  platformsById,
  selection,
  now,
  spotlight,
  onSelect,
  onSelectPlatform,
  onEntity,
  emptyAllCount,
  onShowAll,
}: {
  items: FeedItem[];
  platformsById: Map<string, Platform>;
  selection: Selection;
  now: number;
  spotlight: boolean;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onEntity: (name: string) => void;
  emptyAllCount: number;
  onShowAll?: () => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const { lead, features, stream } = editorialLayout(items, spotlight);
  const shown = stream.slice(0, visible);
  const remaining = stream.length - shown.length;
  const isSelected = (id: string) => selection?.type === "item" && selection.id === id;

  const selectedRestIndex = selection?.type === "item" ? stream.findIndex((i) => i.id === selection.id) : -1;
  useEffect(() => {
    if (selectedRestIndex >= visible) setVisible(Math.ceil((selectedRestIndex + 1) / PAGE_SIZE) * PAGE_SIZE);
  }, [selectedRestIndex, visible]);

  if (items.length === 0) return <EmptyFeed allCount={emptyAllCount} onShowAll={onShowAll} />;
  const rowProps = (item: FeedItem) => ({
    item,
    platform: platformsById.get(item.platform_id),
    platformsById,
    onEntity,
    selected: isSelected(item.id),
    now,
    onSelect,
    onSelectPlatform,
  });
  const topCount = (lead ? 1 : 0) + features.length;
  return (
    <div className="flex flex-col gap-5">
      {lead && (
        <section aria-label="오늘의 리드 소식" data-item-id={lead.id}>
          <LeadStory {...rowProps(lead)} />
        </section>
      )}
      {features.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 @xl:grid-cols-2" aria-label="주요 소식">
          {features.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <FeatureStory {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label={topCount > 0 ? "브리핑" : "소식 목록"}>
          {shown.map((item) => (
            <li key={item.id} data-item-id={item.id}>
              <StreamRow {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="press mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-fg-2 hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          더보기
          <span className="tnum text-[13px] text-fg-3">
            {topCount + shown.length}/{items.length}
          </span>
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export default function RadarApp({ data }: { data: RadarData }) {
  const now = useNow(data.generatedAt);
  const [view, setView] = useState<View>("feed");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  // 첫 진입 시에는 리퀴드 글라스 모달을 닫아 뉴스룸 피드만 깔끔하게 보여준다 (URL 공유 진입 시 자동 오픈)
  const [selection, setSelection] = useState<Selection>(null);

  const platformsById = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const names = useMemo(() => new Map(data.platforms.map((p) => [p.id, p.name])), [data.platforms]);
  const hotItems = useMemo(() => hotFeed(data.items, category, now, query, names), [data.items, category, now, query, names]);
  const pastItems = useMemo(() => pastFeed(data.items, category, query, names), [data.items, category, query, names]);

  const applySelection = useCallback(
    (sel: Selection, fromUrl: boolean) => {
      if (sel?.type === "item") {
        const item = data.items.find((i) => i.id === sel.id);
        if (!item) return false;
        if (fromUrl) setView(item.lifecycle_status === "warm" ? "past" : "feed");
      } else if (sel?.type === "platform") {
        if (!data.platforms.some((p) => p.id === sel.id)) return false;
        if (fromUrl) setView("directory");
      }
      setSelection(sel);
      return true;
    },
    [data.items, data.platforms],
  );

  // 공유 링크(?item= / ?platform=)로 들어왔을 때 자동 오픈 + 브라우저 뒤로/앞으로 가기
  useEffect(() => {
    const fromLocation = () => {
      const sel = readSelectionFromUrl();
      if (sel && applySelection(sel, true)) return;
      setSelection(null);
    };
    if (readSelectionFromUrl()) fromLocation();
    window.addEventListener("popstate", fromLocation);
    return () => window.removeEventListener("popstate", fromLocation);
  }, [applySelection]);

  const counts = useMemo(() => {
    const pool =
      view === "directory"
        ? data.platforms.map((p) => p.category)
        : data.items
            .filter((i) => i.lifecycle_status === (view === "feed" ? "hot" : "warm"))
            .filter((i) => matchesQuery(i, query, names.get(i.platform_id)))
            .map((i) => i.category);
    const c = { all: view === "feed" ? Math.min(pool.length, HOT_LIMIT) : pool.length } as Record<CategoryFilter, number>;
    for (const cat of CATEGORY_ORDER) c[cat] = pool.filter((x) => x === cat).length;
    return c;
  }, [view, data.items, data.platforms, query, names]);

  const viewCounts = useMemo(
    () => ({
      feed: Math.min(data.items.filter((i) => i.lifecycle_status === "hot").length, HOT_LIMIT),
      past: data.items.filter((i) => i.lifecycle_status === "warm").length,
      directory: data.platforms.length,
    }),
    [data.items, data.platforms],
  );

  const selectItem = useCallback((id: string) => {
    const sel: Selection = { type: "item", id };
    setSelection(sel);
    writeSelectionToUrl(sel);
  }, []);
  const selectPlatform = useCallback((id: string) => {
    const sel: Selection = { type: "platform", id };
    setSelection(sel);
    writeSelectionToUrl(sel);
  }, []);
  const close = useCallback(() => {
    setSelection(null);
    writeSelectionToUrl(null);
  }, []);

  const onEntity = useCallback(
    (name: string) => {
      const key = name.toLowerCase().replace(/[\s._-]+/g, "");
      const platform = data.platforms.find((p) => [p.id, p.name].some((x) => x.toLowerCase().replace(/[\s._-]+/g, "") === key));
      if (platform) {
        selectPlatform(platform.id);
        return;
      }
      if (view === "directory") setView("feed");
      setQuery(name);
    },
    [data.platforms, selectPlatform, view],
  );

  const editorial = view === "feed" && category === "all" && !query.trim();
  const feedDisplayItems = view === "feed" ? hotItems : pastItems;

  const navOrder = useMemo(() => {
    if (view === "directory") return [];
    return editorialOrder(editorialLayout(feedDisplayItems, editorial));
  }, [view, feedDisplayItems, editorial]);

  // J / K 탐색 (모달 닫혀 있을 땐 ↑/↓ 도 지원)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const next = e.key === "j" || e.key === "J" || (e.key === "ArrowDown" && !selection);
      const prev = e.key === "k" || e.key === "K" || (e.key === "ArrowUp" && !selection);
      if ((!next && !prev) || navOrder.length === 0) return;
      e.preventDefault();
      const cur = selection?.type === "item" ? navOrder.indexOf(selection.id) : -1;
      const idx = cur === -1 ? 0 : Math.min(navOrder.length - 1, Math.max(0, cur + (next ? 1 : -1)));
      const id = navOrder[idx];
      selectItem(id);
      requestAnimationFrame(() => document.querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOrder, selection, selectItem]);

  const allCountForQuery = useMemo(() => {
    if (!query.trim() || category === "all") return 0;
    return (view === "feed" ? hotFeed(data.items, "all", now, query, names) : pastFeed(data.items, "all", query, names)).length;
  }, [query, category, view, data.items, now, names]);

  const listKey = `${view}:${category}:${query}`;
  const lastCollectedLabel = useMemo(() => formatLastCollected(data.lastCollectedAt, now), [data.lastCollectedAt, now]);

  return (
    // 우측 고정 컬럼 제거: 좌측 사이드바 + 넓고 시원한 Apple Newsroom 에디토리얼 2단 레이아웃
    <div className="w-full min-w-0 lg:grid lg:h-dvh lg:grid-cols-[clamp(248px,17vw,296px)_minmax(0,1fr)] lg:overflow-hidden">
      {/* 좌측: 데스크톱 사이드바 */}
      <div className="hidden min-w-0 overflow-hidden lg:block">
        <Sidebar
          view={view}
          category={category}
          onView={setView}
          onCategory={setCategory}
          counts={counts}
          viewCounts={viewCounts}
          source={data.source}
          platformCount={data.platforms.length}
          lastCollectedAt={data.lastCollectedAt}
          now={now}
        />
      </div>

      {/* 모바일 상단 컨트롤 */}
      <header className="flex min-w-0 flex-col gap-3 border-b border-line bg-surface px-4 pb-3 pt-4 md:px-6 lg:hidden">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Logo />
          <div className="flex shrink-0 items-center gap-2">
            {data.source === "sample" && (
              <span className="whitespace-nowrap rounded-full bg-elevated px-2.5 py-0.5 text-[12.5px] font-medium text-fg-2">엄선 에디션</span>
            )}
            <FontSizeToggle compact />
            <ThemeToggle compact />
          </div>
        </div>
        <ViewTabs view={view} onView={setView} compact />
        <CategoryChips category={category} onCategory={setCategory} counts={counts} layout="row" />
      </header>

      {/* 중앙: Apple Newsroom 와이드 에디토리얼 그리드 */}
      <main className="@container thin-scroll min-w-0 bg-canvas px-4 py-6 md:px-8 lg:overflow-y-auto lg:px-12 lg:py-9">
        <div className="mx-auto w-full min-w-0 max-w-[1160px]">
          {view === "directory" ? (
            <DirectoryView
              platforms={data.platforms}
              items={data.items}
              category={category}
              selectedId={selection?.type === "platform" ? selection.id : null}
              onSelect={selectPlatform}
            />
          ) : (
            <div className="flex flex-col gap-7">
              <FeedHeader view={view} total={feedDisplayItems.length} lastCollectedLabel={lastCollectedLabel}>
                <SearchBox value={query} onChange={setQuery} total={feedDisplayItems.length} />
              </FeedHeader>
              <FeedList
                key={listKey}
                items={feedDisplayItems}
                platformsById={platformsById}
                selection={selection}
                now={now}
                spotlight={editorial}
                onSelect={selectItem}
                onSelectPlatform={selectPlatform}
                onEntity={onEntity}
                emptyAllCount={allCountForQuery}
                onShowAll={category !== "all" ? () => setCategory("all") : undefined}
              />
            </div>
          )}
        </div>
      </main>

      {/* 정중앙 리퀴드 글라스 요약 모달 (기사·플랫폼 클릭 또는 URL 공유 진입 시 오픈) */}
      <LiquidGlassModal
        selection={selection}
        items={data.items}
        platforms={data.platforms}
        onSelectItem={selectItem}
        onSelectPlatform={selectPlatform}
        onClose={close}
        easyMode={data.easyMode}
      />
    </div>
  );
}
