"use client";

import { Activity, ChevronDown, History, Search, Telescope, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { CATEGORY_ORDER } from "@/lib/categories";
import { hotFeed, HOT_LIMIT, matchesQuery, PAGE_SIZE, pastFeed, pickSpotlight, type CategoryFilter } from "@/lib/filter";
import type { FeedItem, Platform, RadarData } from "@/lib/types";

import { BottomSheet, DesktopPanel, SideDrawer, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import ItemCard, { SpotlightCard } from "./ItemCard";
import Sidebar, { CategoryChips, Logo, ViewTabs, type View } from "./Sidebar";

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

function FeedHeader({ view, total, children }: { view: "feed" | "past"; total: number; children: React.ReactNode }) {
  const isFeed = view === "feed";
  const Icon = isFeed ? Activity : History;
  return (
    <header className="flex min-w-0 flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:gap-5">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.02em] text-[#FAFAFA]">
          <Icon className="h-5 w-5 text-zinc-400" strokeWidth={1.8} aria-hidden />
          {isFeed ? "실시간 레이더" : "지난 주요 소식"}
        </h1>
        {isFeed ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono tracking-wider">LIVE</span> · 매시 정각 스캔
          </span>
        ) : (
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">8~30일 전 · 중요도 순</span>
        )}
        <span className="tnum font-mono text-[12px] text-zinc-500">{total} stories</span>
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
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
        className="w-full rounded-xl border border-white/[0.08] border-t-white/[0.14] bg-white/[0.02] py-2 pl-9 pr-24 text-[14px] text-zinc-100 placeholder:text-zinc-500 transition focus:border-white/25 focus:bg-white/[0.04] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {value ? (
          <>
            <span className="font-mono text-[11px] text-zinc-500" aria-live="polite">
              {total}건
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="검색어 지우기"
              className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <kbd className="hidden rounded border border-white/10 px-1.5 py-px font-mono text-[10px] text-zinc-500 sm:inline">/</kbd>
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

/** 화면에 보이는 순서 그대로: TOP SPOTLIGHT → 나머지 (J/K 탐색과 카드 렌더링이 같은 순서를 쓴다) */
function displayOrder(items: FeedItem[], spotlight: boolean): { tops: FeedItem[]; rest: FeedItem[] } {
  const tops = spotlight ? pickSpotlight(items) : [];
  const topIds = new Set(tops.map((i) => i.id));
  return { tops, rest: items.filter((i) => !topIds.has(i.id)) };
}

/**
 * 결과 0건 안내. 특정 분야를 고른 채 검색해서 0건인데 '전체'에는 있으면 그 사실을 알려주고 원클릭으로 넘겨준다
 * (분야 필터 때문에 생기는 '가짜 0건' 구제).
 */
function EmptyFeed({ allCount, onShowAll }: { allCount: number; onShowAll?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <Telescope className="h-6 w-6 text-zinc-500" aria-hidden />
      {onShowAll && allCount > 0 ? (
        <>
          <p className="text-sm leading-relaxed text-zinc-300">
            선택한 분야에는 없지만 전체 피드에 <span className="tnum font-semibold text-zinc-50">{allCount}</span>건이 있어요.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="press rounded-lg bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-950 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            전체에서 보기
          </button>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-zinc-400">이 조건에 맞는 소식이 아직 없어요. 검색어나 필터를 바꿔보시겠어요?</p>
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
  // TOP SPOTLIGHT: 짧은 소셜 단문 제외, 원본 해설이 준비된 기사 우선 (pickSpotlight)
  const { tops, rest } = displayOrder(items, spotlight);
  const shown = rest.slice(0, visible);
  const remaining = rest.length - shown.length;
  const isSelected = (id: string) => selection?.type === "item" && selection.id === id;

  // J/K 로 다음 기사가 '더보기' 너머에 있으면 그만큼 펼친다
  const selectedRestIndex = selection?.type === "item" ? rest.findIndex((i) => i.id === selection.id) : -1;
  useEffect(() => {
    if (selectedRestIndex >= visible) setVisible(Math.ceil((selectedRestIndex + 1) / PAGE_SIZE) * PAGE_SIZE);
  }, [selectedRestIndex, visible]);

  if (items.length === 0) return <EmptyFeed allCount={emptyAllCount} onShowAll={onShowAll} />;
  return (
    <div className="flex flex-col gap-4">
      {tops.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 @5xl:grid-cols-2" aria-label="Top Spotlight">
          {tops.map((item, i) => (
            <li key={item.id} data-item-id={item.id}>
              <SpotlightCard
                item={item}
                rank={i + 1}
                platform={platformsById.get(item.platform_id)}
                platformsById={platformsById}
                onEntity={onEntity}
                selected={isSelected(item.id)}
                now={now}
                onSelect={onSelect}
                onSelectPlatform={onSelectPlatform}
              />
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
          {shown.map((item) => (
            <li key={item.id} data-item-id={item.id} className="flex">
              <div className="flex w-full flex-col">
                <ItemCard
                  item={item}
                  platform={platformsById.get(item.platform_id)}
                  platformsById={platformsById}
                  onEntity={onEntity}
                  selected={isSelected(item.id)}
                  now={now}
                  onSelect={onSelect}
                  onSelectPlatform={onSelectPlatform}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="press mx-auto mt-2 inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-4 py-2 text-[13px] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          더보기
          <span className="font-mono text-[11px] text-zinc-500">
            {tops.length + shown.length}/{items.length}
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

  // 지금 화면에 보이는 순서 (J/K 탐색용)
  const navOrder = useMemo(() => {
    if (view === "directory") return [];
    const list = view === "feed" ? hotItems : pastItems;
    const { tops, rest } = displayOrder(list, view === "feed" && !query.trim());
    return [...tops, ...rest].map((i) => i.id);
  }, [view, hotItems, pastItems, query]);

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
  const listKey = `${view}:${category}:${query}`;

  return (
    // 1024~1359: 사이드바(220) + 피드 2단 / >=1360: + 우측 고정 패널 3단. 모든 열은 min-w-0 로 좌우 밀림 방지
    <div className="w-full min-w-0 lg:grid lg:h-dvh lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden wide:grid-cols-[228px_minmax(0,1fr)_clamp(380px,28vw,460px)]">
      {/* 좌측: 데스크톱 사이드바 */}
      <div className="hidden min-w-0 overflow-hidden border-r border-white/[0.06] bg-[#0C0C0F] lg:block">
        <Sidebar
          view={view}
          category={category}
          onView={setView}
          onCategory={setCategory}
          counts={counts}
          viewCounts={viewCounts}
          source={data.source}
        />
      </div>

      {/* 모바일 상단 컨트롤 */}
      <header className="flex min-w-0 flex-col gap-3 border-b border-white/[0.06] bg-[#0C0C0F] px-4 pb-3 pt-4 md:px-6 lg:hidden">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Logo />
          {data.source === "sample" && (
            <span className="shrink-0 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-0.5 text-[11px] text-amber-200/90">
              샘플 데이터
            </span>
          )}
        </div>
        <ViewTabs view={view} onView={setView} compact />
        <CategoryChips category={category} onCategory={setCategory} counts={counts} layout="row" />
      </header>

      {/* 중앙 */}
      {/* 샘플 데이터 안내는 사이드바 하단(데스크톱)·상단 바 배지(좁은 화면)에 있으므로 피드 상단 배너는 두지 않는다 */}
      <main className="@container thin-scroll min-w-0 px-4 py-6 md:px-6 lg:overflow-y-auto lg:px-7 lg:py-6 wide:px-8">

        {view === "directory" ? (
          <DirectoryView
            platforms={data.platforms}
            items={data.items}
            category={category}
            selectedId={visibleSelection?.type === "platform" ? visibleSelection.id : null}
            onSelect={selectPlatform}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <FeedHeader view={view} total={view === "feed" ? hotItems.length : pastItems.length}>
              <SearchBox value={query} onChange={setQuery} total={view === "feed" ? hotItems.length : pastItems.length} />
            </FeedHeader>
            <FeedList
              key={listKey}
              items={view === "feed" ? hotItems : pastItems}
              platformsById={platformsById}
              selection={visibleSelection}
              now={now}
              spotlight={view === "feed" && !query.trim()}
              onSelect={selectItem}
              onSelectPlatform={selectPlatform}
              onEntity={onEntity}
              emptyAllCount={allCountForQuery}
              onShowAll={category !== "all" ? () => setCategory("all") : undefined}
            />
          </div>
        )}
      </main>

      {/* 우측: 와이드 고정 패널 / 분할 창 드로어 / 모바일 바텀시트 — 화면 폭에 맞는 하나만 렌더링 */}
      <div className="hidden min-w-0 wide:block wide:h-dvh">{layout === "wide" && <DesktopPanel {...panelProps} />}</div>
      {layout === "split" && <SideDrawer {...panelProps} selection={sheetOpen ? selection : null} onClose={closeSheet} />}
      {layout === "mobile" && <BottomSheet {...panelProps} selection={sheetOpen ? selection : null} onClose={closeSheet} />}
    </div>
  );
}
