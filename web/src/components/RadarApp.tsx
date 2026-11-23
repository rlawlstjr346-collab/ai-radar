"use client";

import { ChevronDown, Sparkles, Telescope, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
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
import { FeatureStory, isXItem, LeadStory, StreamRow } from "./ItemCard";
import type { View } from "./Sidebar";
import TopNavHeader, { type TitleLang } from "./TopNavHeader";

const CLOCK_TICK_MS = 60_000;
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
 * 상·중단 그리드 슬롯(#3, #6, #9)에 최대 3건을 자연스럽게 인터리빙한다.
 * 전체 기사 목록과 개수는 100% 보존한다.
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

/** Apple Newsroom 가로 토픽 필터 바 */
function HorizontalCategoryBar({
  category,
  onCategory,
  counts,
}: {
  category: CategoryFilter;
  onCategory: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
}) {
  return (
    <nav aria-label="분야 필터" className="thin-scroll -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1">
      <button
        type="button"
        aria-pressed={category === "all"}
        onClick={() => onCategory("all")}
        className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[0.88rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          category === "all"
            ? "bg-fg font-semibold text-canvas shadow-xs"
            : "border border-line bg-surface font-medium text-fg-2 hover:border-line-strong hover:text-fg"
        }`}
      >
        <span>전체</span>
        <span className={`tnum text-[0.76rem] ${category === "all" ? "opacity-80" : "text-fg-3"}`}>{counts.all}</span>
      </button>

      {CATEGORY_ORDER.map((cat) => {
        const meta = CATEGORY_META[cat];
        const active = category === cat;
        const count = counts[cat];
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={active}
            onClick={() => onCategory(cat)}
            className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[0.88rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? "bg-fg font-semibold text-canvas shadow-xs"
                : "border border-line bg-surface font-medium text-fg-2 hover:border-line-strong hover:text-fg"
            }`}
          >
            <meta.Icon className="h-[0.95rem] w-[0.95rem] shrink-0" strokeWidth={2} aria-hidden />
            <span>{meta.label}</span>
            <span className={`tnum text-[0.76rem] ${active ? "opacity-80" : "text-fg-3"}`}>{count}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** 웹 정체성 서브 헤더 + 3개 미니 캡슐 배지 + 가로 토픽 필터 */
function NewsroomHeroHeader({
  view,
  total,
  platformCount,
  lastCollectedLabel,
  category,
  onCategory,
  counts,
}: {
  view: View;
  total: number;
  platformCount: number;
  lastCollectedLabel?: string | null;
  category: CategoryFilter;
  onCategory: (c: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
}) {
  const heading =
    view === "feed" ? "실시간 레이더" : view === "past" ? "지난 주요 소식" : "글로벌 AI 플랫폼 도감";
  const countUnit = view === "directory" ? `${platformCount}곳` : `${total}건`;

  return (
    <section className="flex flex-col gap-4 border-b border-line pb-6">
      <div className="flex flex-col gap-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[clamp(1.65rem,2.2vw+0.6rem,2.25rem)] font-bold leading-tight tracking-[-0.026em] text-fg">
            {heading}
          </h1>
          <span className="t-meta inline-flex flex-wrap items-center gap-1.5">
            {view === "feed" && (
              <>
                <span className="live-ping" aria-hidden />
                <span>20분 자동 스캔</span>
                <span aria-hidden>·</span>
              </>
            )}
            {view === "past" && (
              <>
                <span>8~30일 전 · 중요도 순</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="tnum font-semibold text-fg-2">{countUnit}</span>
            {lastCollectedLabel && view === "feed" && (
              <>
                <span aria-hidden>·</span>
                <span className="tnum">마지막 수집 {lastCollectedLabel}</span>
              </>
            )}
          </span>
        </div>

        {/* 1초 만에 읽히는 웹 정체성 한 줄 소개 */}
        <p className="max-w-[74ch] text-[0.98rem] leading-relaxed text-fg-2">
          전 세계 140+ AI 미디어 · 𝕏 빌더 이슈 · GitHub 트렌드를 20분마다 수집해 한국어 1분 요약과 실전 활용법으로 전달합니다.
        </p>

        {/* 3개 미니 캡슐 배지 */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.78rem] font-semibold text-fg-2">
            <Zap className="h-[0.85rem] w-[0.85rem] text-[#FF9500]" strokeWidth={2.2} aria-hidden />
            20분 자동 수집
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.78rem] font-semibold text-fg-2">
            <span aria-hidden>🇰🇷</span>
            한국어 후킹 요약
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.78rem] font-semibold text-fg-2">
            <Sparkles className="h-[0.85rem] w-[0.85rem] text-[#007AFF]" strokeWidth={2.2} aria-hidden />
            클릭 시 1분 활용 팁
          </span>
        </div>
      </div>

      {/* Apple Newsroom 가로 토픽 필터 바 */}
      <HorizontalCategoryBar category={category} onCategory={onCategory} counts={counts} />
    </section>
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
          <p className="text-[0.95rem] leading-relaxed text-fg-2">
            선택한 분야에는 없지만 전체 피드에 <span className="tnum font-semibold text-fg">{allCount}</span>건이 있어요.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="press rounded-full bg-fg px-5 py-2 text-[0.88rem] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            전체에서 보기
          </button>
        </>
      ) : (
        <p className="text-[0.95rem] leading-relaxed text-fg-2">이 조건에 맞는 소식이 아직 없어요. 검색어나 필터를 바꿔보시겠어요?</p>
      )}
    </div>
  );
}

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
    lang,
    onSelect,
    onSelectPlatform,
  });
  const topCount = (lead ? 1 : 0) + features.length;
  return (
    <div className="flex flex-col gap-6">
      {/* 최상단 1열 와이드 히어로 후킹 카드 */}
      {lead && (
        <section aria-label="오늘의 리드 소식" data-item-id={lead.id}>
          <LeadStory {...rowProps(lead)} />
        </section>
      )}

      {/* 중단 2열 균형 서브 피처드 그리드 */}
      {features.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2" aria-label="주요 소식">
          {features.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <FeatureStory {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}

      {/* 하단 2열 대칭 Apple Newsroom 에디토리얼 그리드 */}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2" aria-label={topCount > 0 ? "브리핑" : "소식 목록"}>
          {shown.map((item) => (
            <li key={item.id} data-item-id={item.id} className="min-w-0">
              <StreamRow {...rowProps(item)} />
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="press mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-6 py-2.5 text-[0.9rem] font-semibold text-fg-2 hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          더보기
          <span className="tnum text-[0.82rem] text-fg-3">
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

  const allCountForQuery = useMemo(() => {
    if (!query.trim() || category === "all") return 0;
    return (view === "feed" ? hotFeed(data.items, "all", now, query, names) : pastFeed(data.items, "all", query, names)).length;
  }, [query, category, view, data.items, now, names]);

  const listKey = `${view}:${category}:${query}`;
  const lastCollectedLabel = useMemo(() => formatLastCollected(data.lastCollectedAt, now), [data.lastCollectedAt, now]);
  const lastCollectedTitle = data.lastCollectedAt
    ? `마지막 자동 수집: ${new Date(data.lastCollectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)`
    : undefined;

  return (
    <div className="min-h-dvh w-full min-w-0 bg-canvas text-fg">
      {/* 상단 Sticky Frosted-Glass Apple Newsroom 헤더 */}
      <TopNavHeader
        view={view}
        onView={setView}
        viewCounts={viewCounts}
        query={query}
        onQuery={setQuery}
        resultCount={feedDisplayItems.length}
        lang={lang}
        onLang={handleLang}
        lastCollectedLabel={lastCollectedLabel}
        lastCollectedTitle={lastCollectedTitle}
      />

      {/* 중앙 대칭 에디토리얼 메인 컨테이너 (좌측 사이드바 완전 제거) */}
      <main className="@container mx-auto w-full min-w-0 max-w-[1160px] px-4 pb-16 pt-7 sm:px-6 lg:px-8 lg:pt-9">
        <div className="flex flex-col gap-7">
          <NewsroomHeroHeader
            view={view}
            total={feedDisplayItems.length}
            platformCount={data.platforms.length}
            lastCollectedLabel={lastCollectedLabel}
            category={category}
            onCategory={setCategory}
            counts={counts}
          />

          {view === "directory" ? (
            <DirectoryView
              platforms={data.platforms}
              items={data.items}
              category={category}
              query={query}
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
              emptyAllCount={allCountForQuery}
              onShowAll={category !== "all" ? () => setCategory("all") : undefined}
            />
          )}
        </div>
      </main>

      {/* 정중앙 고밀도 리퀴드 글라스 요약 모달 (기사·플랫폼 클릭 또는 URL 공유 진입 시 오픈) */}
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
