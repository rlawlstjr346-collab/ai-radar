"use client";

import { Check, Link2, Radar, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { copyText } from "@/lib/clipboard";
import type { EasyOriginalMode, FeedItem, Platform } from "@/lib/types";

import ItemDetail from "./ItemDetail";
import PlatformProfile from "./PlatformProfile";

export type Selection = { type: "item"; id: string } | { type: "platform"; id: string } | null;

interface Props {
  selection: Selection;
  items: FeedItem[];
  platforms: Platform[];
  onSelectItem: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onClose: () => void;
  /** [원본 쉽게 읽기] 제공 방식 — 해설을 띄울 수 없는 기사에선 유도 배너를 숨긴다 */
  easyMode: EasyOriginalMode;
}

const ICON_BTN =
  "press grid h-8 w-8 place-items-center rounded-md bg-surface/80 text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** 현재 선택을 공유 URL(?item= / ?platform=)로 */
export function shareUrlFor(selection: NonNullable<Selection>, location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}?${selection.type}=${encodeURIComponent(selection.id)}`;
}

function selectedHeading(selection: Selection, items: FeedItem[], platforms: Platform[]): string {
  if (!selection) return "";
  if (selection.type === "item") return items.find((i) => i.id === selection.id)?.hook_title ?? "";
  return platforms.find((p) => p.id === selection.id)?.name ?? "";
}

/** 우측 패널 스크롤 진행률(0~100) + 프로스티드 바 활성화 상태 추적 */
function useReadingProgress(scrollRef: React.RefObject<HTMLDivElement | null>, resetKey: string) {
  const [progress, setProgress] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    setScrolled(top > 12);
    setProgress(Math.min(100, Math.max(0, (top / max) * 100)));
  }, [scrollRef]);

  useEffect(() => {
    setProgress(0);
    setScrolled(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey, scrollRef]);

  return { progress, scrolled, onScroll };
}

/** Apple Newsroom 스타일 프로스티드 상단 바 + 2px 읽기 진행 바 */
function ReadingChrome({
  title,
  scrolled,
  progress,
  selection,
  onClose,
}: {
  title: string;
  scrolled: boolean;
  progress: number;
  selection: Selection;
  onClose: () => void;
}) {
  return (
    <div
      data-scrolled={scrolled ? "true" : "false"}
      className="reading-sticky-bar sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-transparent px-4 sm:px-6"
    >
      <p
        className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg transition-opacity duration-200 ${
          scrolled && title ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!scrolled}
      >
        {title}
      </p>
      <PanelActions selection={selection} onClose={onClose} />
      {/* 2px Reading Progress Bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-transparent"
      >
        <div
          className="h-full bg-accent transition-[width] duration-75 ease-out"
          style={{ width: `${scrolled ? progress : 0}%` }}
        />
      </div>
    </div>
  );
}

/** 우상단 [링크 복사] [닫기] — 복사하면 아이콘이 체크로 바뀌고 토스트가 뜬다 */
function PanelActions({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  if (!selection) return null;
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={async () => setCopied((await copyText(shareUrlFor(selection, window.location))) ? "ok" : "fail")}
          aria-label="공유 링크 복사"
          title="공유 링크 복사"
          className={ICON_BTN}
        >
          {copied === "ok" ? <Check className="h-4 w-4 text-accent" aria-hidden /> : <Link2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
        </button>
        <button type="button" onClick={onClose} aria-label="상세 보기 닫기" className={ICON_BTN}>
          <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      {copied &&
        createPortal(
          <div
            role="status"
            className="animate-toast-in fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-lg bg-fg px-4 py-2 text-[13.5px] font-medium text-canvas"
          >
            {copied === "ok" ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
            {copied === "ok" ? "공유 링크가 복사됐어요" : "복사하지 못했어요. 주소창의 링크를 복사해 주세요"}
          </div>,
          document.body,
        )}
    </>
  );
}

function PanelContent({ selection, items, platforms, onSelectItem, onSelectPlatform }: Omit<Props, "onClose">) {
  const byId = new Map(platforms.map((p) => [p.id, p]));
  if (selection?.type === "item") {
    const item = items.find((i) => i.id === selection.id);
    if (item)
      return (
        <ItemDetail
          item={item}
          platform={byId.get(item.platform_id)}
          onSelectPlatform={onSelectPlatform}
          canReadEasy
        />
      );
  }
  if (selection?.type === "platform") {
    const platform = byId.get(selection.id);
    if (platform) return <PlatformProfile platform={platform} items={items} onSelectItem={onSelectItem} />;
  }
  return <EmptyPanel />;
}

function EmptyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-elevated">
        <Radar className="h-5 w-5 text-fg-2" strokeWidth={1.8} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="text-[16px] font-semibold text-fg">레이더 요원 대기 중이에요</p>
        <p className="text-[14.5px] leading-relaxed text-fg-2">
          가운데 카드를 누르면 여기서 1분 핵심 요약과 실전 활용 팁을 풀어드리고,
          <br />
          플랫폼 배지를 누르면 그곳이 어떤 사이트인지 소개해 드려요!
        </p>
      </div>
    </div>
  );
}

/** 와이드(≥1360px) 우측 고정 패널 */
export function DesktopPanel(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";
  const { progress, scrolled, onScroll } = useReadingProgress(scrollRef, key);
  const title = selectedHeading(props.selection, props.items, props.platforms);

  return (
    <aside aria-label="상세 보기" className="relative flex h-full flex-col border-l border-line bg-surface">
      <div ref={scrollRef} onScroll={onScroll} className="thin-scroll h-full overflow-y-auto">
        {props.selection && (
          <ReadingChrome title={title} scrolled={scrolled} progress={progress} selection={props.selection} onClose={props.onClose} />
        )}
        <div key={key} className="animate-article-enter -mt-2">
          <PanelContent {...props} />
        </div>
      </div>
    </aside>
  );
}

/** 모바일(<768px) 바텀시트. 핸들을 아래로 끌거나, 바깥을 누르거나, ESC 로 닫힌다. */
export function BottomSheet(props: Props) {
  const open = props.selection !== null;
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";
  const { progress, scrolled, onScroll } = useReadingProgress(scrollRef, key);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    setDragY(0);
  }, [key]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  };
  const onPointerUp = () => {
    if (startY.current === null) return;
    if (dragY > 110) onClose();
    else setDragY(0);
    startY.current = null;
    setDragging(false);
  };

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-scrim"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="상세 보기"
        tabIndex={-1}
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 180ms ease-out" }}
        className="animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-surface focus:outline-none"
      >
        <div
          data-scrolled={scrolled ? "true" : "false"}
          className="reading-sticky-bar relative flex shrink-0 touch-none items-center justify-between border-b border-transparent px-4 pb-1.5 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="w-[4.5rem]" />
          <span className="h-1 w-10 cursor-grab rounded-full bg-line-strong active:cursor-grabbing" aria-hidden />
          <PanelActions selection={props.selection} onClose={onClose} />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
            <div className="h-full bg-accent transition-[width] duration-75 ease-out" style={{ width: `${scrolled ? progress : 0}%` }} />
          </div>
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="thin-scroll overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        >
          <div key={key} className="animate-article-enter">
            <PanelContent {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 분할 창·노트북(768~1359px) 오른쪽 슬라이드 오버 드로어.
 */
export function SideDrawer(props: Props) {
  const open = props.selection !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";
  const { progress, scrolled, onScroll } = useReadingProgress(scrollRef, key);
  const title = selectedHeading(props.selection, props.items, props.platforms);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="상세 보기"
        tabIndex={-1}
        className="animate-drawer-in absolute inset-y-0 right-0 flex w-[min(560px,92vw)] min-w-0 flex-col bg-surface focus:outline-none"
      >
        <div ref={scrollRef} onScroll={onScroll} className="thin-scroll h-full overflow-y-auto overscroll-contain">
          <ReadingChrome title={title} scrolled={scrolled} progress={progress} selection={props.selection} onClose={onClose} />
          <div key={key} className="animate-article-enter -mt-2">
            <PanelContent {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}
