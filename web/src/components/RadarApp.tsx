"use client";

import { ChevronDown, Search, Telescope, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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
  pickSpotlight,
  type CategoryFilter,
} from "@/lib/filter";
import type { FeedItem, Platform, RadarData } from "@/lib/types";

import { BottomSheet, DesktopPanel, SideDrawer, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import FontSizeToggle from "./FontSizeToggle";
import { FeatureStory, LeadStory, StreamRow } from "./ItemCard";
import Sidebar, { CategoryChips, Logo, ViewTabs, type View } from "./Sidebar";
import ThemeToggle from "./ThemeToggle";
import XRealtimeBoard from "./XRealtimeBoard";

const CLOCK_TICK_MS = 60_000;

/**
 * 화면 폭 3단계 (CSS 브레이크포인트와 같은 값)
 *   wide   >=1360px : 사이드바 + 피드 + 우측 고정 패널 (3단)
 *   split  768~1359 : 피드 중심, 상세는 오른쪽 슬라이드 드로어 (1024 미만은 상단 가로 필터 바)
 *   mobile <768     : 상단 바 + 바텀시트
 */
type LayoutMode = "wide" | "split" | "mobile";
const WIDE_QUERY = "(min-width: 1360px)";
const SPLIT_QUERY = "(min-width: 768px)";

function readLayoutMode(): LayoutMode {
  if (window.matchMedia(WIDE_QUERY).matches) return "wide";
  if (window.matchMedia(SPLIT_QUERY).matches) return "split";
  return "mobile";
}

/** 서버 렌더에선 wide 로 그린 뒤, 브라우저에서 실제 폭으로 바로 맞춘다 */
function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(
    (cb) => {
      const queries = [WIDE_QUERY, SPLIT_QUERY].map((q) => window.matchMedia(q));
      queries.forEach((mq) => mq.addEventListener("change", cb));
      return () => queries.forEach((mq) => mq.removeEventListener("change", cb));
    },
    readLayoutMode,
    () => "wide",
  );
}

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
        <h1 className="text-[clamp(21px,1.3vw+5px,26px)] font-bold tracking-[-0.02em] text-fg">{isFeed ? "실시간 레이더" : "지난 주요 소식"}</h1>
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" strokeWidth={1.8} aria-hidden />
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
        className="w-full rounded-lg bg-surface py-2 pl-9 pr-24 text-[14px] text-fg placeholder:text-fg-3 transition-colors duration-100 hover:bg-elevated focus:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {value ? (
          <>
            <span className="tnum text-[12px] text-fg-3" aria-live="polite">
              {total}건
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="검색어 지우기"
              className="grid h-6 w-6 place-items-center rounded-md text-fg-3 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <kbd className="hidden rounded bg-canvas px-1.5 py-px text-[11px] text-fg-3 sm:inline">/</kbd>
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


/**
 * 결과 0건 안내. 특정 분야를 고른 채 검색해서 0건인데 '전체'에는 있으면 그 사실을 알려주고 원클릭으로 넘겨준다
 * (분야 필터 때문에 생기는 '가짜 0건' 구제).
 */
function EmptyFeed({ allCount, onShowAll }: { allCount: number; onShowAll?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-6 py-12 text-center">
      <Telescope className="h-5 w-5 text-fg-3" strokeWidth={1.8} aria-hidden />
      {onShowAll && allCount > 0 ? (
        <>
          <p className="text-[15px] leading-relaxed text-fg-2">
            선택한 분야에는 없지만 전체 피드에 <span className="tnum font-semibold text-fg">{allCount}</span>건이 있어요.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="press rounded-lg bg-fg px-3.5 py-2 text-[13.5px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
  // 1면: 리드 1 + 피처 2 (짧은 소셜 단문 제외, 원본 해설이 준비된 기사 우선 — pickSpotlight). 필터·검색이면 스트림만
  const { lead, features, stream } = editorialLayout(items, spotlight);
  const shown = stream.slice(0, visible);
  const remaining = stream.length - shown.length;
  const isSelected = (id: string) => selection?.type === "item" && selection.id === id;

  // J/K 로 다음 기사가 '더보기' 너머에 있으면 그만큼 펼친다
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
    <div className="flex flex-col gap-6">
      {lead && (
        <section aria-label="오늘의 리드 소식" data-item-id={lead.id}>
          <LeadStory {...rowProps(lead)} />
        </section>
      )}
      {features.length > 0 && (
        <ul className="grid grid-cols-1 gap-3.5 @xl:grid-cols-2" aria-label="주요 소식">
          {features.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <FeatureStory {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={topCount > 0 ? "브리핑" : "소식 목록"}>
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
          className="press mx-auto inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13.5px] font-medium text-fg-2 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          더보기
          <span className="tnum text-[12px] text-fg-3">
            {topCount + shown.length}/{items.length}
          </span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export default function RadarApp({ data }: { data: RadarData }) {
  const layout = useLayoutMode();
  const now = useNow(data.generatedAt);
  const [view, setView] = useState<View>("feed");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [xOnly, setXOnly] = useState(false);
  // 와이드 화면 첫 진입 시 우측 패널이 놀지 않도록 1면 첫 카드(TOP SPOTLIGHT 01)를 기본 선택 (URL 에는 쓰지 않는다).
  // 드로어·바텀시트 구간에선 이 기본 선택으로 화면을 가리지 않는다 (sheetOpen=false 유지).
  const defaultSelection = useMemo<Selection>(() => {
    const ranked = hotFeed(data.items, "all", Date.parse(data.generatedAt));
    const first = pickSpotlight(ranked)[0] ?? ranked[0];
    return first ? { type: "item", id: first.id } : null;
  }, [data.items, data.generatedAt]);
  const [selection, setSelection] = useState<Selection>(defaultSelection);
  // 드로어·바텀시트는 사용자가 직접 눌렀거나 공유 링크로 들어왔을 때만 연다
  const [sheetOpen, setSheetOpen] = useState(false);

  const platformsById = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const names = useMemo(() => new Map(data.platforms.map((p) => [p.id, p.name])), [data.platforms]);
  const hotItems = useMemo(() => hotFeed(data.items, category, now, query, names), [data.items, category, now, query, names]);
  const pastItems = useMemo(() => pastFeed(data.items, category, query, names), [data.items, category, query, names]);
  // X 실시간 전용 분리 보드용 아이템 (실시간 레이더 전체·검색 기준)
  const xHotItems = useMemo(() => hotFeed(data.items, "all", now, query, names).filter((i) => i.platform_id === "x"), [data.items, now, query, names]);
  // X 전용 보드가 상단에 떠 있는 기본 실시간 피드에서는 일반 기사 스트림과 깔끔하게 분리 (xOnly 켜면 X 전용 모아보기)
  const showXBoard = view === "feed" && xHotItems.length > 0 && (category === "all" || category === "social" || xOnly);
  const feedDisplayItems = useMemo(() => {
    if (view !== "feed") return pastItems;
    if (xOnly) return xHotItems;
    if (showXBoard && category === "all" && !query.trim()) {
      return hotItems.filter((i) => i.platform_id !== "x");
    }
    return hotItems;
  }, [view, pastItems, xOnly, xHotItems, showXBoard, category, query, hotItems]);

  // URL 의 선택이 실제 데이터에 있는지 확인하고, 그 기사/플랫폼이 보이는 탭으로 이동
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

  // 공유 링크로 들어왔을 때 + 브라우저 뒤로/앞으로 가기
  useEffect(() => {
    const fromLocation = () => {
      const sel = readSelectionFromUrl();
      if (sel && applySelection(sel, true)) {
        setSheetOpen(true);
      } else {
        setSelection(defaultSelection);
        setSheetOpen(false);
      }
    };
    if (readSelectionFromUrl()) fromLocation();
    window.addEventListener("popstate", fromLocation);
    return () => window.removeEventListener("popstate", fromLocation);
  }, [applySelection, defaultSelection]);

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
    setSheetOpen(true);
    writeSelectionToUrl(sel);
  }, []);
  const selectPlatform = useCallback((id: string) => {
    const sel: Selection = { type: "platform", id };
    setSelection(sel);
    setSheetOpen(true);
    writeSelectionToUrl(sel);
  }, []);
  const close = useCallback(() => {
    setSelection(null);
    setSheetOpen(false);
    writeSelectionToUrl(null);
  }, []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    writeSelectionToUrl(null);
  }, []);

  // 엔티티(기술 태그) 클릭: 같은 이름의 플랫폼이 있으면 그 프로필, 없으면 그 키워드로 즉시 검색
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

  // 1면 편집(리드·피처)은 실시간 레이더의 '전체' 화면에서만. 분야 필터·검색·X 전용 모아보기는 스트림 규칙
  const editorial = view === "feed" && category === "all" && !query.trim() && !xOnly;

  // 지금 화면에 보이는 순서 (J/K 탐색용)
  const navOrder = useMemo(() => {
    if (view === "directory") return [];
    return editorialOrder(editorialLayout(feedDisplayItems, editorial));
  }, [view, feedDisplayItems, editorial]);

  // J / ↓ : 다음 기사, K / ↑ : 이전 기사 — 검색창 등 입력 중이 아닐 때만
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const next = e.key === "j" || e.key === "J" || e.key === "ArrowDown";
      const prev = e.key === "k" || e.key === "K" || e.key === "ArrowUp";
      if ((!next && !prev) || navOrder.length === 0) return;
      // 화살표는 드로어·바텀시트 안 스크롤과 겹치므로, 상세가 덮개로 열려 있을 땐 J/K 만
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && sheetOpen && layout !== "wide") return;
      e.preventDefault();
      const cur = selection?.type === "item" ? navOrder.indexOf(selection.id) : -1;
      const idx = cur === -1 ? 0 : Math.min(navOrder.length - 1, Math.max(0, cur + (next ? 1 : -1)));
      const id = navOrder[idx];
      selectItem(id);
      requestAnimationFrame(() => document.querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOrder, selection, selectItem, sheetOpen, layout]);

  // 분야를 고른 채 검색해서 0건일 때, 전체 피드 기준 건수
  const allCountForQuery = useMemo(() => {
    if (!query.trim() || category === "all") return 0;
    return (view === "feed" ? hotFeed(data.items, "all", now, query, names) : pastFeed(data.items, "all", query, names)).length;
  }, [query, category, view, data.items, now, names]);

  const panelProps = {
    selection,
    items: data.items,
    platforms: data.platforms,
    onSelectItem: selectItem,
    onSelectPlatform: selectPlatform,
    onClose: close,
    easyMode: data.easyMode,
  };
  // 카드 '선택됨' 표시는 상세 내용이 실제로 화면에 보일 때만
  const visibleSelection: Selection = layout === "wide" || sheetOpen ? selection : null;
  // 필터·보기가 바뀌면 '더보기' 페이지 수를 처음으로 되돌린다
  const listKey = `${view}:${category}:${query}:${xOnly ? "x" : "all"}`;
  const lastCollectedLabel = useMemo(() => formatLastCollected(data.lastCollectedAt, now), [data.lastCollectedAt, now]);

  const handleViewChange = useCallback((v: View) => {
    setView(v);
    if (v !== "feed") setXOnly(false);
  }, []);
  const handleCategoryChange = useCallback((c: CategoryFilter) => {
    setCategory(c);
    setXOnly(false);
  }, []);

  return (
    // 와이드·고해상도 모니터에서 중앙 피드가 좁아지지 않도록 3단 비율 및 중앙 폭 시원하게 확장
    <div className="w-full min-w-0 lg:grid lg:h-dvh lg:grid-cols-[clamp(248px,16vw,292px)_minmax(0,1fr)] lg:overflow-hidden wide:grid-cols-[clamp(256px,16vw,296px)_minmax(0,1fr)_clamp(500px,37vw,700px)]">
      {/* 좌측: 데스크톱 사이드바 */}
      <div className="hidden min-w-0 overflow-hidden bg-surface lg:block">
        <Sidebar
          view={view}
          category={category}
          onView={handleViewChange}
          onCategory={handleCategoryChange}
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
              <span className="whitespace-nowrap rounded bg-elevated px-2 py-0.5 text-[13px] font-medium text-fg-2">엄선 에디션</span>
            )}
            <FontSizeToggle compact />
            <ThemeToggle compact />
          </div>
        </div>
        <ViewTabs view={view} onView={handleViewChange} compact />
        <CategoryChips category={category} onCategory={handleCategoryChange} counts={counts} layout="row" />
      </header>

      {/* 중앙 */}
      <main className="@container thin-scroll min-w-0 px-4 py-6 md:px-6 lg:overflow-y-auto lg:px-8 xl:px-10 lg:py-8">
        <div className="mx-auto w-full min-w-0 max-w-[1320px]">

        {view === "directory" ? (
          <DirectoryView
            platforms={data.platforms}
            items={data.items}
            category={category}
            selectedId={visibleSelection?.type === "platform" ? visibleSelection.id : null}
            onSelect={selectPlatform}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <FeedHeader
              view={view}
              total={feedDisplayItems.length}
              lastCollectedLabel={lastCollectedLabel}
            >
              <SearchBox value={query} onChange={setQuery} total={feedDisplayItems.length} />
            </FeedHeader>
            {showXBoard && (
              <XRealtimeBoard
                items={xHotItems}
                selectedId={visibleSelection?.type === "item" ? visibleSelection.id : null}
                now={now}
                xOnly={xOnly}
                onToggleXOnly={() => setXOnly((v) => !v)}
                onSelect={selectItem}
              />
            )}
            <FeedList
              key={listKey}
              items={feedDisplayItems}
              platformsById={platformsById}
              selection={visibleSelection}
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

      {/* 우측: 와이드 고정 패널 / 분할 창 드로어 / 모바일 바텀시트 — 화면 폭에 맞는 하나만 렌더링 */}
      <div className="hidden min-w-0 wide:block wide:h-dvh">{layout === "wide" && <DesktopPanel {...panelProps} />}</div>
      {layout === "split" && <SideDrawer {...panelProps} selection={sheetOpen ? selection : null} onClose={closeSheet} />}
      {layout === "mobile" && <BottomSheet {...panelProps} selection={sheetOpen ? selection : null} onClose={closeSheet} />}
    </div>
  );
}
