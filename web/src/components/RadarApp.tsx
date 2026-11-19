"use client";

import { Activity, ChevronDown, History, Info, Telescope } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { CATEGORY_ORDER } from "@/lib/categories";
import { hotFeed, HOT_LIMIT, PAGE_SIZE, pastFeed, SPOTLIGHT_COUNT, type CategoryFilter } from "@/lib/filter";
import type { FeedItem, Platform, RadarData } from "@/lib/types";

import { BottomSheet, DesktopPanel, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import ItemCard, { SpotlightCard } from "./ItemCard";
import Sidebar, { BeginnerToggle, CategoryChips, Logo, ViewTabs, type View } from "./Sidebar";

const DESKTOP_QUERY = "(min-width: 1024px)"; // Tailwind lg
const CLOCK_TICK_MS = 60_000;

/** 화면이 lg 이상인지. 서버 렌더에선 true(데스크톱 패널) */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
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

function FeedHeader({ view, total }: { view: "feed" | "past"; total: number }) {
  const isFeed = view === "feed";
  const Icon = isFeed ? Activity : History;
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="flex items-center gap-2.5 text-[26px] font-semibold tracking-[-0.02em] text-white">
          <Icon className="h-6 w-6 text-emerald-300" strokeWidth={1.8} aria-hidden />
          {isFeed ? "오늘의 AI 레이더 피드" : "지난 주요 소식"}
        </h1>
        {isFeed && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            Live · hourly
          </span>
        )}
        <span className="font-mono text-[12px] text-gray-500">{total} stories</span>
      </div>
      <p className="max-w-2xl text-[14.5px] leading-relaxed text-gray-400">
        {isFeed
          ? "전 세계 AI 연구소와 커뮤니티에서 매시간 물어온 소식을, 몰라도 술술 읽히게 풀어왔어요. 방금 들어온 소식일수록 위에 있어요."
          : "8~30일 전에 들어온 소식 중 중요했던 것들이에요. 놓친 이야기가 있는지 훑어보세요."}
      </p>
    </header>
  );
}

function EmptyFeed() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <Telescope className="h-6 w-6 text-gray-500" aria-hidden />
      <p className="text-sm leading-relaxed text-gray-400">이 조건에 맞는 소식이 아직 없어요. 필터를 바꿔보시겠어요?</p>
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
}: {
  items: FeedItem[];
  platformsById: Map<string, Platform>;
  selection: Selection;
  now: number;
  spotlight: boolean;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const tops = spotlight ? items.slice(0, SPOTLIGHT_COUNT) : [];
  const rest = items.slice(tops.length);
  const shown = rest.slice(0, visible);
  const remaining = rest.length - shown.length;
  const isSelected = (id: string) => selection?.type === "item" && selection.id === id;

  if (items.length === 0) return <EmptyFeed />;
  return (
    <div className="flex flex-col gap-4">
      {tops.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 @5xl:grid-cols-2" aria-label="Top Spotlight">
          {tops.map((item, i) => (
            <li key={item.id}>
              <SpotlightCard
                item={item}
                rank={i + 1}
                platform={platformsById.get(item.platform_id)}
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
            <li key={item.id} className="flex">
              <div className="flex w-full flex-col">
                <ItemCard
                  item={item}
                  platform={platformsById.get(item.platform_id)}
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
          className="mx-auto mt-2 inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-4 py-2 text-[13px] text-gray-300 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          더보기
          <span className="font-mono text-[11px] text-gray-500">
            {tops.length + shown.length}/{items.length}
          </span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export default function RadarApp({ data }: { data: RadarData }) {
  const isDesktop = useIsDesktop();
  const now = useNow(data.generatedAt);
  const [view, setView] = useState<View>("feed");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [beginnerOnly, setBeginnerOnly] = useState(false); // 첫 접속엔 모든 기사가 보이도록 OFF
  // 첫 진입 시 데스크톱 우측 패널이 놀지 않도록 최상단 카드를 기본 선택
  const [selection, setSelection] = useState<Selection>(() => {
    const first = hotFeed(data.items, "all", false, Date.parse(data.generatedAt))[0];
    return first ? { type: "item", id: first.id } : null;
  });
  // 모바일 바텀시트는 사용자가 직접 눌렀을 때만 연다 (기본 선택으로 화면을 가리지 않게)
  const [sheetOpen, setSheetOpen] = useState(false);

  const platformsById = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const hotItems = useMemo(() => hotFeed(data.items, category, beginnerOnly, now), [data.items, category, beginnerOnly, now]);
  const pastItems = useMemo(() => pastFeed(data.items, category, beginnerOnly), [data.items, category, beginnerOnly]);

  const counts = useMemo(() => {
    const pool =
      view === "directory"
        ? data.platforms.map((p) => p.category)
        : data.items
            .filter((i) => i.lifecycle_status === (view === "feed" ? "hot" : "warm"))
            .filter((i) => !beginnerOnly || i.difficulty === 1)
            .map((i) => i.category);
    const c = { all: view === "feed" ? Math.min(pool.length, HOT_LIMIT) : pool.length } as Record<CategoryFilter, number>;
    for (const cat of CATEGORY_ORDER) c[cat] = pool.filter((x) => x === cat).length;
    return c;
  }, [view, data.items, data.platforms, beginnerOnly]);

  const viewCounts = useMemo(
    () => ({
      feed: Math.min(data.items.filter((i) => i.lifecycle_status === "hot").length, HOT_LIMIT),
      past: data.items.filter((i) => i.lifecycle_status === "warm").length,
      directory: data.platforms.length,
    }),
    [data.items, data.platforms],
  );

  const selectItem = useCallback((id: string) => {
    setSelection({ type: "item", id });
    setSheetOpen(true);
  }, []);
  const selectPlatform = useCallback((id: string) => {
    setSelection({ type: "platform", id });
    setSheetOpen(true);
  }, []);
  const close = useCallback(() => {
    setSelection(null);
    setSheetOpen(false);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const panelProps = {
    selection,
    items: data.items,
    platforms: data.platforms,
    onSelectItem: selectItem,
    onSelectPlatform: selectPlatform,
    onClose: close,
  };
  // 필터·보기가 바뀌면 '더보기' 페이지 수를 처음으로 되돌린다
  const listKey = `${view}:${category}:${beginnerOnly}`;

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[236px_minmax(0,1fr)_400px] lg:overflow-hidden xl:grid-cols-[248px_minmax(0,1fr)_440px]">
      {/* 좌측: 데스크톱 사이드바 */}
      <div className="hidden border-r border-white/[0.06] bg-[#090d14] lg:block">
        <Sidebar
          view={view}
          category={category}
          beginnerOnly={beginnerOnly}
          onView={setView}
          onCategory={setCategory}
          onBeginnerOnly={setBeginnerOnly}
          counts={counts}
          viewCounts={viewCounts}
          source={data.source}
        />
      </div>

      {/* 모바일 상단 컨트롤 */}
      <header className="flex flex-col gap-3 border-b border-white/[0.06] bg-[#090d14] px-4 pb-3 pt-4 lg:hidden">
        <Logo />
        <ViewTabs view={view} onView={setView} compact />
        <CategoryChips category={category} onCategory={setCategory} counts={counts} layout="row" />
        {view !== "directory" && <BeginnerToggle value={beginnerOnly} onChange={setBeginnerOnly} />}
      </header>

      {/* 중앙 */}
      <main className="@container thin-scroll min-w-0 px-4 py-6 sm:px-6 lg:overflow-y-auto lg:px-8 lg:py-8">
        {data.notice && (
          <div role="status" className="mb-6 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-[13px] text-gray-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
            <span className="leading-relaxed">{data.notice}</span>
          </div>
        )}

        {view === "directory" ? (
          <DirectoryView
            platforms={data.platforms}
            items={data.items}
            category={category}
            selectedId={selection?.type === "platform" ? selection.id : null}
            onSelect={selectPlatform}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <FeedHeader view={view} total={view === "feed" ? hotItems.length : pastItems.length} />
            <FeedList
              key={listKey}
              items={view === "feed" ? hotItems : pastItems}
              platformsById={platformsById}
              selection={selection}
              now={now}
              spotlight={view === "feed"}
              onSelect={selectItem}
              onSelectPlatform={selectPlatform}
            />
          </div>
        )}
      </main>

      {/* 우측: 데스크톱 컨텍스트 패널 / 모바일 바텀시트 */}
      <div className="hidden lg:block lg:h-dvh">{isDesktop && <DesktopPanel {...panelProps} />}</div>
      {!isDesktop && <BottomSheet {...panelProps} selection={sheetOpen ? selection : null} onClose={closeSheet} />}
    </div>
  );
}
