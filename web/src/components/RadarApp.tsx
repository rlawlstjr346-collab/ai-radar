"use client";

import { Telescope } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import {
  editorialLayout,
  editorialOrder,
  hotFeed,
  HOT_LIMIT,
  pastFeed,
  type CategoryFilter,
} from "@/lib/filter";
import type { FeedItem, Platform, RadarData } from "@/lib/types";

import { LiquidGlassModal, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import { FeatureStory, isXItem, LeadStory, StreamRow } from "./ItemCard";
import Sidebar, { MobileHeader, type TitleLang, type View } from "./Sidebar";

const CLOCK_TICK_MS = 60_000;
const INFINITE_BATCH = 20;
const LANG_STORAGE_KEY = "ai-radar:lang";

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

/**
 * 실시간 레이더 기본 전체 피드에서 X(Twitter) 빌더/런칭 이슈가 최하단에 묻히지 않도록
 * 상·중단 슬롯(#3, #6, #9)에 최대 3건을 자연스럽게 인터리빙한다.
 */
function interleaveXItems(items: FeedItem[]): FeedItem[] {
  const xItems = items.filter((i) => isXItem(i));
  if (xItems.length === 0 || items.length < 4) return items;

  const topNineX = items.slice(0, 9).filter((i) => isXItem(i)).length;
  if (topNineX >= Math.min(3, xItems.length)) return items;

  const promoted = xItems.slice(0, 3);
  const promotedIds = new Set(promoted.map((i) => i.id));
  const rest = items.filter((i) => !promotedIds.has(i.id));

  const targetSlots = [2, 5, 8];
  const result = [...rest];
  promoted.forEach((xItem, idx) => {
    const slot = Math.min(targetSlots[idx] ?? result.length, result.length);
    result.splice(slot, 0, xItem);
  });
  return result;
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
          <p className="text-[0.95rem] leading-relaxed text-fg-2">
            선택한 분야에는 없지만 전체 피드에 <span className="tnum font-semibold text-fg">{allCount}</span>건이 있어요.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="press rounded-full bg-fg px-5 py-2 text-[0.88rem] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            전체에서 보기
          </button>
        </>
      ) : (
        <p className="text-[0.95rem] leading-relaxed text-fg-2">이 분야에 맞는 소식이 아직 없어요. 다른 분야를 선택해 보세요.</p>
      )}
    </div>
  );
}

/** 자동 무한 스크롤(IntersectionObserver, rootMargin 400px) 적용 피드 목록 */
function FeedList({
  items,
  platformsById,
  selection,
  now,
  lang,
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
  lang: TitleLang;
  spotlight: boolean;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onEntity: (name: string) => void;
  emptyAllCount: number;
  onShowAll?: () => void;
}) {
  const [visible, setVisible] = useState(INFINITE_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { lead, features, stream } = editorialLayout(items, spotlight);
  const shown = stream.slice(0, visible);
  const remaining = stream.length - shown.length;
  const isSelected = (id: string) => selection?.type === "item" && selection.id === id;

  const selectedRestIndex = selection?.type === "item" ? stream.findIndex((i) => i.id === selection.id) : -1;
  useEffect(() => {
    if (selectedRestIndex >= visible) {
      setVisible(Math.ceil((selectedRestIndex + 1) / INFINITE_BATCH) * INFINITE_BATCH);
    }
  }, [selectedRestIndex, visible]);

  useEffect(() => {
    if (remaining <= 0) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(stream.length, v + INFINITE_BATCH));
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [remaining, stream.length]);

  if (items.length === 0) return <EmptyFeed allCount={emptyAllCount} onShowAll={onShowAll} />;

  const rowProps = (item: FeedItem) => ({
    item,
    platform: platformsById.get(item.platform_id),
    platformsById,
    onEntity,
    selected: isSelected(item.id),
    now,
    lang,
    onSelect,
    onSelectPlatform,
  });

  const topCount = (lead ? 1 : 0) + features.length;

  return (
    <div className="flex flex-col gap-5">
      {/* 최상단 대표 후킹 기사 1개 (Apple Newsroom 둥근 피처드 카드) */}
      {lead && (
        <section aria-label="오늘의 대표 소식" data-item-id={lead.id}>
          <LeadStory {...rowProps(lead)} />
        </section>
      )}

      {/* 주요 피처 2열 카드 */}
      {features.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="주요 소식">
          {features.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <FeatureStory {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}

      {/* 정갈하고 큼직한 에디토리얼 아티클 스트림 */}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label={topCount > 0 ? "최신 에디토리얼 피드" : "소식 목록"}>
          {shown.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <StreamRow {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}

      {/* 자동 무한 스크롤 센티넬 */}
      {remaining > 0 && (
        <div ref={sentinelRef} aria-hidden className="flex h-12 items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-3/50" />
        </div>
      )}
    </div>
  );
}

export default function RadarApp({ data }: { data: RadarData }) {
  const now = useNow(data.generatedAt);
  const [view, setView] = useState<View>("feed");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [lang, setLang] = useState<TitleLang>("ko");
  // 첫 진입 시에는 리퀴드 글라스 모달을 닫아 뉴스룸 피드만 깔끔하게 보여준다 (URL 공유 진입 시 자동 오픈)
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === "ko" || saved === "en") setLang(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleLang = useCallback((next: TitleLang) => {
    setLang(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  const platformsById = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const names = useMemo(() => new Map(data.platforms.map((p) => [p.id, p.name])), [data.platforms]);
  const hotItems = useMemo(() => hotFeed(data.items, category, now, "", names), [data.items, category, now, names]);
  const pastItems = useMemo(() => pastFeed(data.items, category, "", names), [data.items, category, names]);

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
            .map((i) => i.category);
    const c = { all: view === "feed" ? Math.min(pool.length, HOT_LIMIT) : pool.length } as Record<CategoryFilter, number>;
    for (const cat of CATEGORY_ORDER) c[cat] = pool.filter((x) => x === cat).length;
    return c;
  }, [view, data.items, data.platforms]);

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
      }
    },
    [data.platforms, selectPlatform],
  );

  const editorial = view === "feed" && category === "all";
  const feedDisplayItems = useMemo(() => {
    if (view === "past") return pastItems;
    return editorial ? interleaveXItems(hotItems) : hotItems;
  }, [view, editorial, hotItems, pastItems]);

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

  const listKey = `${view}:${category}`;
  const sectionTitle =
    view === "feed" ? "실시간 레이더" : view === "past" ? "지난 주요 소식" : "AI 플랫폼 도감";
  const activeCatLabel = category === "all" ? null : CATEGORY_META[category].label;
  const totalLabel = view === "directory" ? `${data.platforms.length}곳` : `${feedDisplayItems.length}건`;

  const sidebarProps = {
    view,
    category,
    onView: setView,
    onCategory: setCategory,
    counts,
    viewCounts,
    lang,
    onLang: handleLang,
    source: data.source,
    platformCount: data.platforms.length,
    lastCollectedAt: data.lastCollectedAt,
    now,
  };

  return (
    <div className="min-h-dvh w-full min-w-0 bg-canvas text-fg">
      {/* 모바일(<lg) 반응형 상단 로고 + 가로 탭/컬러도트 필터 */}
      <MobileHeader {...sidebarProps} />

      {/* 데스크톱: 좌측 240px 여백 일체형 컬럼(무배경) + 우측 메인 아티클 스트림 */}
      <div className="mx-auto w-full max-w-[1220px] px-4 sm:px-6 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12 lg:px-8">
        <div className="hidden lg:block">
          <Sidebar {...sidebarProps} />
        </div>

        <main className="@container min-w-0 pb-20 pt-6 lg:pt-8">
          {/* Apple ML Research 'All publications' 스타일 1줄 섹션 타이틀 — 바로 아래부터 즉시 기사 시작 */}
          <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-3.5">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
              <h1 className="text-[1.7rem] font-bold leading-tight tracking-[-0.024em] text-fg">
                {sectionTitle}
              </h1>
              {activeCatLabel && (
                <span className={`text-[0.95rem] font-semibold ${CATEGORY_META[category as Exclude<CategoryFilter, "all">].text}`}>
                  · {activeCatLabel}
                </span>
              )}
            </div>
            <span className="t-meta tnum">{totalLabel}</span>
          </header>

          {view === "directory" ? (
            <DirectoryView
              platforms={data.platforms}
              items={data.items}
              category={category}
              selectedId={selection?.type === "platform" ? selection.id : null}
              onSelect={selectPlatform}
            />
          ) : (
            <FeedList
              key={listKey}
              items={feedDisplayItems}
              platformsById={platformsById}
              selection={selection}
              now={now}
              lang={lang}
              spotlight={editorial}
              onSelect={selectItem}
              onSelectPlatform={selectPlatform}
              onEntity={onEntity}
              emptyAllCount={counts.all}
              onShowAll={category !== "all" ? () => setCategory("all") : undefined}
            />
          )}
        </main>
      </div>

      {/* 정중앙 고밀도 리퀴드 글라스 4단 요약 모달 (기사·플랫폼 클릭 또는 URL 공유 진입 시 오픈) */}
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
