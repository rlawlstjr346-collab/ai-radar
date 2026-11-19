"use client";

import { Radar, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

function PanelContent({ selection, items, platforms, onSelectItem, onSelectPlatform, easyMode }: Omit<Props, "onClose">) {
  const byId = new Map(platforms.map((p) => [p.id, p]));
  if (selection?.type === "item") {
    const item = items.find((i) => i.id === selection.id);
    if (item)
      return (
        <ItemDetail
          item={item}
          platform={byId.get(item.platform_id)}
          onSelectPlatform={onSelectPlatform}
          canReadEasy={item.easy_original_ready || easyMode === "on_demand"}
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
      <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-emerald-400/20 bg-card-2">
        <span
          className="radar-sweep absolute inset-0 bg-[conic-gradient(from_0deg,rgba(52,211,153,0.4),transparent_30%)]"
          aria-hidden
        />
        <span className="absolute inset-3 rounded-full border border-emerald-400/15" aria-hidden />
        <Radar className="relative h-8 w-8 text-emerald-300" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold text-white">레이더 요원 대기 중이에요</p>
        <p className="text-sm leading-relaxed text-gray-400">
          가운데 카드를 누르면 여기서 4단계로 쉽게 풀어드리고,
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
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [key]);

  return (
    <aside aria-label="상세 보기" className="relative flex h-full flex-col border-l border-white/10 bg-[#0d121c]">
      {props.selection && (
        <button
          type="button"
          onClick={props.onClose}
          aria-label="상세 보기 닫기"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-gray-300 backdrop-blur transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
      <div ref={scrollRef} className="thin-scroll h-full overflow-y-auto" key={key}>
        <div className="animate-fade-in">
          <PanelContent {...props} />
        </div>
      </div>
    </aside>
  );
}

/** 모바일(<768px) 바텀시트. 핸들을 아래로 끌거나, 바깥을 누르거나, ESC 로 닫힌다. (모바일에서만 렌더링됨) */
export function BottomSheet(props: Props) {
  const open = props.selection !== null;
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";

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
    scrollRef.current?.scrollTo({ top: 0 });
    setDragY(0);
  }, [key]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // 닫기 버튼은 드래그 대상 아님
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
        className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="상세 보기"
        tabIndex={-1}
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 180ms ease-out" }}
        className="animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl border-t border-white/15 bg-[#0d121c] shadow-[0_-12px_40px_rgba(0,0,0,0.6)] focus:outline-none"
      >
        <div
          className="flex shrink-0 touch-none items-center justify-between px-4 pb-1 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="w-8" />
          <span className="h-1.5 w-11 cursor-grab rounded-full bg-white/25 active:cursor-grabbing" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="상세 보기 닫기"
            className="grid h-8 w-8 place-items-center rounded-full text-gray-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div ref={scrollRef} key={key} className="thin-scroll overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <PanelContent {...props} />
        </div>
      </div>
    </div>
  );
}

/**
 * 분할 창·노트북(768~1359px) 오른쪽 슬라이드 오버 드로어.
 * 상시 공간을 차지하지 않고, 반투명 딤 위로 열린다. X·바깥 클릭·Esc 로 닫힌다.
 */
export function SideDrawer(props: Props) {
  const open = props.selection !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [key]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="상세 보기"
        tabIndex={-1}
        className="animate-drawer-in absolute inset-y-0 right-0 flex w-[min(480px,92vw)] min-w-0 flex-col border-l border-white/15 bg-[#0d121c] shadow-[-16px_0_48px_rgba(0,0,0,0.55)] focus:outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="상세 보기 닫기"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-gray-300 backdrop-blur transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div ref={scrollRef} key={key} className="thin-scroll h-full overflow-y-auto overscroll-contain">
          <PanelContent {...props} />
        </div>
      </div>
    </div>
  );
}
