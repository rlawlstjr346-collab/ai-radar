"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { formatLastCollected, matchesQuery } from "@/lib/filter";
import { buildFrontPage, foldClusters, frontPageOrder, itemsForTab, newestFirst, type NewsTab } from "@/lib/front-page";
import { fetchLatestLiveFeed, isNewerSnapshot, mergeLiveFeedItems, type ClientLiveSnapshot } from "@/lib/live-client";
import type { FeedItem, RadarData } from "@/lib/types";
import { collectClusterItemIds, formatVisitDividerLabel, loadReadIds, recordReadIds, type VisitDividerInfo } from "@/lib/visit-state";

import { LiquidGlassModal, type Selection } from "./ContextPanel";
import DirectoryView from "./DirectoryView";
import BriefingModal from "./newsroom/BriefingModal";
import FrontPage from "./newsroom/FrontPage";
import { CategoryNav, Masthead } from "./newsroom/Masthead";
import type { TitleLang } from "./Sidebar";

const CLOCK_TICK_MS = 30_000;
const LIVE_POLL_INTERVAL_MS = 30_000;
const LIVE_REFRESH_MIN_GAP_MS = 15_000;
const AUTO_MERGE_SCROLL_Y = 240;
const PILL_VISIBLE_MS = 7_000;

/** 기준 시각: 첫 렌더는 서버가 데이터를 만든 시각(hydration 일치), 이후 30초마다 현재 시각 */
function useNow(initialIso: string): number {
  const [now, setNow] = useState(() => Date.parse(initialIso));
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

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

/** 마지막 방문 이후 경계 마커 — 1px 가로 실선 + 작은 무채색 라벨 */
export function VisitDivider({ info, lang, className = "" }: { info: VisitDividerInfo; lang: TitleLang; className?: string }) {
  const label = formatVisitDividerLabel(info, lang);
  return (
    <div
      role="separator"
      aria-label={label}
      data-visit-divider="true"
      className={`col-span-full my-1 flex w-full select-none items-center gap-3.5 py-1.5 ${className}`}
    >
      <span className="h-px flex-1 bg-line-strong/80" aria-hidden />
      <span className="shrink-0 text-[12.5px] font-medium tracking-[-0.01em] text-fg-3">{label}</span>
      <span className="h-px flex-1 bg-line-strong/80" aria-hidden />
    </div>
  );
}

function countNew(prev: FeedItem[], next: FeedItem[]): number {
  const ids = new Set(prev.map((i) => i.id));
  return next.filter((i) => !ids.has(i.id)).length;
}

export default function RadarApp({ data }: { data: RadarData }) {
  const now = useNow(data.generatedAt);
  const [items, setItems] = useState<FeedItem[]>(data.items);
  const [lastCollectedAt, setLastCollectedAt] = useState<string | null>(data.lastCollectedAt ?? null);
  // 엣지 5분 스캔이 마지막으로 확인한 시각 — 새 기사가 없어도 '마지막 업데이트'가 실제 확인 시각을 따라간다
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<NewsTab>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [selection, setSelection] = useState<Selection>(null);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [pending, setPending] = useState<ClientLiveSnapshot | null>(null);
  const [arrival, setArrival] = useState<{ count: number; applied: boolean } | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const lastCollectedRef = useRef(lastCollectedAt);
  const apiSinceRef = useRef<string | null>(null);
  lastCollectedRef.current = lastCollectedAt;

  useEffect(() => setReadIds(loadReadIds()), []);
  const readIdSet = useMemo(() => new Set(readIds), [readIds]);
  const markRead = useCallback((ids: string[]) => {
    if (ids.length > 0) setReadIds((prev) => recordReadIds(prev, ids));
  }, []);

  const validPlatformIds = useMemo(() => new Set(data.platforms.map((p) => p.id)), [data.platforms]);
  const platformsById = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const names = useMemo(() => new Map(data.platforms.map((p) => [p.id, p.name])), [data.platforms]);

  const applySnapshot = useCallback((snap: ClientLiveSnapshot) => {
    const activeId = selectionRef.current?.type === "item" ? selectionRef.current.id : null;
    setItems((prev) => mergeLiveFeedItems(prev, snap.items, activeId));
    if (snap.generatedAt) setLastCollectedAt(snap.generatedAt);
    setPending(null);
  }, []);

  // 마운트 직후 + 60초 주기 + 탭 포커스 복귀 시 GitHub Raw 최신 피드 조회 → generated_at 이 더 새로우면 병합
  useEffect(() => {
    if (data.source === "supabase") return;
    let ctrl: AbortController | null = null;
    let lastFetch = 0;
    const sync = (force: boolean) => {
      const t = Date.now();
      if (!force && t - lastFetch < LIVE_REFRESH_MIN_GAP_MS) return;
      lastFetch = t;
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      fetchLatestLiveFeed(validPlatformIds, c.signal, fetch, apiSinceRef.current)
        .then((snap) => {
          if (!snap || c.signal.aborted) return;
          if (snap.scannedAt) setScannedAt((prev) => (isNewerSnapshot(snap.scannedAt, prev) ? snap.scannedAt! : prev));
          if (snap.source === "api" && snap.generatedAt && !snap.unchanged) apiSinceRef.current = snap.generatedAt;
          if (snap.unchanged || !isNewerSnapshot(snap.generatedAt, lastCollectedRef.current)) return;
          const fresh = countNew(itemsRef.current, snap.items);
          const reading = window.scrollY > AUTO_MERGE_SCROLL_Y || selectionRef.current !== null;
          if (fresh === 0 || !reading) {
            applySnapshot(snap);
            if (fresh > 0) setArrival({ count: fresh, applied: true });
          } else {
            // 읽던 자리가 튀지 않게 보류하고 '새 소식 N건 도착' 필로 알린다
            setPending(snap);
            setArrival({ count: fresh, applied: false });
          }
        })
        .catch(() => {
          // 네트워크 실패 시 번들 피드 유지
        });
    };
    sync(true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") sync(true);
    }, LIVE_POLL_INTERVAL_MS);
    const onFocus = () => sync(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctrl?.abort();
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [data.source, validPlatformIds, applySnapshot]);

  useEffect(() => {
    if (!arrival?.applied) return;
    const t = setTimeout(() => setArrival(null), PILL_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [arrival]);

  const onArrivalClick = () => {
    if (pending) applySnapshot(pending);
    setArrival(null);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // 워커가 엄격하게 묶은 동일 사건(같은 사건 · 36시간 · 다른 매체)만 카드 1장으로 접는다
  const clustered = useMemo(() => foldClusters(items, Date.parse(data.generatedAt)), [items, data.generatedAt]);
  const knownIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of clustered) {
      s.add(i.id);
      for (const r of i.relatedArticles ?? []) s.add(r.id);
    }
    return s;
  }, [clustered]);

  const tabItems = useMemo(() => itemsForTab(clustered, tab), [clustered, tab]);
  const searchResults = useMemo(() => {
    if (!deferredQuery) return null;
    const pool = clustered.filter((i) => matchesQuery(i, deferredQuery, names.get(i.platform_id)));
    return newestFirst(pool, now);
  }, [clustered, deferredQuery, names, now]);
  const layout = useMemo(() => buildFrontPage(tabItems, now), [tabItems, now]);

  const findItem = useCallback(
    (id: string): FeedItem | undefined =>
      clustered.find((i) => i.id === id) ??
      clustered.flatMap((i) => i.relatedArticles ?? []).find((r) => r.id === id) ??
      items.find((i) => i.id === id),
    [clustered, items],
  );

  const openItem = useCallback(
    (id: string) => {
      const target = findItem(id);
      markRead(target ? collectClusterItemIds(target) : [id]);
      const sel: Selection = { type: "item", id };
      setSelection(sel);
      writeSelectionToUrl(sel);
    },
    [findItem, markRead],
  );
  const openPlatform = useCallback((id: string) => {
    const sel: Selection = { type: "platform", id };
    setSelection(sel);
    writeSelectionToUrl(sel);
  }, []);
  const close = useCallback(() => {
    setSelection(null);
    writeSelectionToUrl(null);
  }, []);

  // 공유 링크(?item= / ?platform=) 진입 자동 오픈 + 뒤로/앞으로 가기
  useEffect(() => {
    const fromLocation = () => {
      const sel = readSelectionFromUrl();
      if (sel?.type === "item" && findItem(sel.id)) {
        markRead(collectClusterItemIds(findItem(sel.id)!));
        setSelection(sel);
      } else if (sel?.type === "platform" && platformsById.has(sel.id)) {
        setTab("directory");
        setSelection(sel);
      } else {
        setSelection(null);
      }
    };
    fromLocation();
    window.addEventListener("popstate", fromLocation);
    return () => window.removeEventListener("popstate", fromLocation);
    // 첫 진입·히스토리 이동 때만 동기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTab = useCallback((t: NewsTab) => {
    setTab(t);
    setQuery("");
    const nav = document.querySelector<HTMLElement>(".catnav");
    if (nav && window.scrollY > nav.offsetTop) window.scrollTo({ top: nav.offsetTop, behavior: "auto" });
  }, []);

  // J / K 탐색
  const navOrder = useMemo(
    () => (searchResults ? searchResults.map((i) => i.id) : tab === "directory" ? [] : frontPageOrder(layout)),
    [searchResults, tab, layout],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || navOrder.length === 0) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const next = e.key === "j" || e.key === "J";
      const prev = e.key === "k" || e.key === "K";
      if (!next && !prev) return;
      e.preventDefault();
      const cur = selection?.type === "item" ? navOrder.indexOf(selection.id) : -1;
      const idx = cur === -1 ? 0 : Math.min(navOrder.length - 1, Math.max(0, cur + (next ? 1 : -1)));
      openItem(navOrder[idx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOrder, selection, openItem]);

  const lastLabel = formatLastCollected(isNewerSnapshot(scannedAt, lastCollectedAt) ? scannedAt : lastCollectedAt, now);
  const statusLabel = lastLabel ? (lastLabel === "방금 전" ? "방금 업데이트" : `마지막 업데이트 ${lastLabel}`) : "실시간 수신 중";
  const selectedItem = selection?.type === "item" ? findItem(selection.id) ?? null : null;

  // 연속 읽기: 현재 피드 순서에서 다음 미열람 기사(없으면 바로 다음) / 이전 기사
  const { nextItem, prevItem } = useMemo(() => {
    if (!selectedItem) return { nextItem: null, prevItem: null };
    const idx = navOrder.indexOf(selectedItem.id);
    const after = idx >= 0 ? navOrder.slice(idx + 1) : navOrder;
    const nextId = after.find((id) => id !== selectedItem.id && !readIdSet.has(id)) ?? after.find((id) => id !== selectedItem.id);
    const prevId = idx > 0 ? navOrder[idx - 1] : null;
    return {
      nextItem: nextId ? findItem(nextId) ?? null : null,
      prevItem: prevId ? findItem(prevId) ?? null : null,
    };
    // readIdSet 은 읽음 표시가 바뀔 때 '다음 미열람' 을 새로 고르기 위해 포함
  }, [selectedItem, navOrder, readIdSet, findItem]);
  const emptyLayout = { hero: null, side: [], wire: [], features: [], stream: searchResults ?? [] };

  return (
    <div className="newsroom">
      <Masthead statusLabel={statusLabel} query={query} onQuery={setQuery} />
      <CategoryNav tab={tab} onTab={changeTab} />

      {arrival && (
        <button type="button" className="arrival-pill" onClick={onArrivalClick} aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          {arrival.applied ? (
            <>
              실시간 수신 중 · 새 소식 <span className="tnum">{arrival.count}</span>건 반영
            </>
          ) : (
            <>
              새 소식 <span className="tnum">{arrival.count}</span>건 도착 · 눌러서 보기
            </>
          )}
        </button>
      )}

      <main className="wrap newsroom-main" id="main">
        <div key={tab} className="tab-panel">
        {searchResults ? (
          searchResults.length > 0 ? (
            <FrontPage
              layout={emptyLayout}
              now={now}
              platformsById={platformsById}
              readIds={readIdSet}
              onOpen={openItem}
              streamTitle={`‘${deferredQuery}’ 검색 결과`}
            />
          ) : (
            <p className="empty-note">‘{deferredQuery}’에 맞는 소식이 아직 없어요. 다른 키워드로 찾아보세요.</p>
          )
        ) : tab === "directory" ? (
          <div className="directory-wrap">
            <DirectoryView
              platforms={data.platforms}
              items={items}
              category="all"
              selectedId={selection?.type === "platform" ? selection.id : null}
              onSelect={openPlatform}
            />
          </div>
        ) : layout.hero ? (
          <FrontPage
            layout={layout}
            now={now}
            platformsById={platformsById}
            readIds={readIdSet}
            onOpen={openItem}
            wireTitle={tab === "past" ? "최근 정리된 순" : "최신 속보"}
            streamTitle={tab === "past" ? "지난 소식 전체" : "시간순 전체 소식"}
          />
        ) : (
          <p className="empty-note">이 분류에는 아직 소식이 없어요. ‘전체’ 탭에서 다른 소식을 둘러보세요.</p>
        )}
        </div>
      </main>

      <footer className="wrap newsroom-foot">
        <p>
          AI RADAR는 공개 RSS·API·커뮤니티 글을 15분마다 모아 쉬운 말로 정리해요. 기사 저작권은 각 원문 매체에 있어요.
        </p>
      </footer>

      <BriefingModal
        item={selectedItem}
        nextItem={nextItem}
        prevItem={prevItem}
        now={now}
        platformsById={platformsById}
        knownIds={knownIds}
        onOpen={openItem}
        onClose={close}
      />
      {selection?.type === "platform" && (
        <LiquidGlassModal
          selection={selection}
          items={clustered}
          platforms={data.platforms}
          onSelectItem={openItem}
          onSelectPlatform={openPlatform}
          onMarkRead={markRead}
          onClose={close}
          easyMode={data.easyMode}
        />
      )}
    </div>
  );
}
