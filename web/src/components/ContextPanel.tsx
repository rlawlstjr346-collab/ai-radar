"use client";

import { Check, Link2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { copyText } from "@/lib/clipboard";
import type { EasyOriginalMode, FeedItem, Platform } from "@/lib/types";

import ItemDetail from "./ItemDetail";
import PlatformProfile from "./PlatformProfile";
import type { TitleLang } from "./Sidebar";

export type Selection = { type: "item"; id: string } | { type: "platform"; id: string } | null;

interface Props {
  selection: Selection;
  items: FeedItem[];
  platforms: Platform[];
  lang?: TitleLang;
  onSelectItem: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onMarkRead?: (ids: string[]) => void;
  onClose: () => void;
  easyMode: EasyOriginalMode;
}

const ICON_BTN =
  "press grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/75 text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** 현재 선택을 공유 URL(?item= / ?platform=)로 */
export function shareUrlFor(selection: NonNullable<Selection>, location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}?${selection.type}=${encodeURIComponent(selection.id)}`;
}

function selectedHeading(selection: Selection, items: FeedItem[], platforms: Platform[]): string {
  if (!selection) return "";
  if (selection.type === "item") {
    const found =
      items.find((i) => i.id === selection.id) ??
      items.find((i) => i.relatedArticles?.some((r) => r.id === selection.id));
    return found?.hook_title ?? "";
  }
  return platforms.find((p) => p.id === selection.id)?.name ?? "";
}

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
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={async () => setCopied((await copyText(shareUrlFor(selection, window.location))) ? "ok" : "fail")}
          aria-label="공유 링크 복사"
          title="공유 링크 복사"
          className={ICON_BTN}
        >
          {copied === "ok" ? <Check className="h-4 w-4 text-accent" aria-hidden /> : <Link2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
        </button>
        <button type="button" onClick={onClose} aria-label="상세 보기 닫기" title="닫기 (ESC)" className={ICON_BTN}>
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
      {copied &&
        createPortal(
          <div
            role="status"
            className="animate-toast-in fixed bottom-6 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-4 py-2 text-[0.86rem] font-medium text-canvas shadow-lg"
          >
            {copied === "ok" ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
            {copied === "ok" ? "공유 링크가 복사됐어요" : "복사하지 못했어요. 주소창의 링크를 복사해 주세요"}
          </div>,
          document.body,
        )}
    </>
  );
}

function PanelContent({ selection, items, platforms, lang, onSelectItem, onSelectPlatform, onMarkRead }: Omit<Props, "onClose">) {
  const byId = new Map(platforms.map((p) => [p.id, p]));
  if (selection?.type === "item") {
    const item =
      items.find((i) => i.id === selection.id) ??
      items.find((i) => i.relatedArticles?.some((r) => r.id === selection.id));
    if (item) {
      return (
        <ItemDetail
          key={item.id}
          item={item}
          platform={byId.get(item.platform_id)}
          platformsById={byId}
          lang={lang}
          onSelectPlatform={onSelectPlatform}
          onMarkRead={onMarkRead}
          canReadEasy
        />
      );
    }
  }
  if (selection?.type === "platform") {
    const platform = byId.get(selection.id);
    if (platform) return <PlatformProfile key={platform.id} platform={platform} items={items} onSelectItem={onSelectItem} />;
  }
  return null;
}

/**
 * iOS 26 / visionOS Liquid Glass 정중앙 플로팅 요약 모달.
 * - 유리 굴절 블러(blur 36px saturate 190%) + Specular Rim 광택 테두리
 * - ESC 키, 바깥 배경 클릭, 우상단 ✕ 버튼으로 닫기 + 오픈 시 바디 스크롤 잠금
 */
export function LiquidGlassModal(props: Props) {
  const open = props.selection !== null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const key = props.selection ? `${props.selection.type}:${props.selection.id}` : "empty";
  const { progress, scrolled, onScroll } = useReadingProgress(scrollRef, key);
  const title = selectedHeading(props.selection, props.items, props.platforms);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* 딤드 블러 백드롭 (뒤쪽 뉴스룸이 은은하게 비침) */}
      <button
        type="button"
        aria-label="모달 닫기"
        tabIndex={-1}
        onClick={onClose}
        className="liquid-backdrop animate-fade-in fixed inset-0 cursor-default"
      />

      {/* 정중앙 리퀴드 글라스 본체 */}
      <div
        ref={dialogRef}
        key={key}
        role="dialog"
        aria-modal="true"
        aria-label={title || "기사 요약 상세 보기"}
        tabIndex={-1}
        className="liquid-glass-modal animate-liquid-modal z-10 flex flex-col overflow-hidden focus:outline-none"
      >
        {/* 상단 프로스티드 컨트롤 바 + 2px 읽기 진행 바 */}
        <div
          data-scrolled={scrolled ? "true" : "false"}
          className="reading-sticky-bar relative z-20 flex h-16 shrink-0 select-none items-center justify-between gap-3 border-b border-transparent px-7 sm:px-10"
        >
          <p
            className={`min-w-0 flex-1 truncate text-[15.5px] font-semibold text-fg transition-opacity duration-200 ${
              scrolled && title ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden={!scrolled}
          >
            {title}
          </p>
          <PanelActions selection={props.selection} onClose={onClose} />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
            <div
              className="h-full bg-fg/70 transition-[width] duration-75 ease-out"
              style={{ width: `${scrolled ? progress : 0}%` }}
            />
          </div>
        </div>

        {/* 내부 부드러운 스크롤 본문 */}
        <div ref={scrollRef} onScroll={onScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="animate-article-enter">
            <PanelContent {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 기존 이름 호환 */
export const DesktopPanel = LiquidGlassModal;
export const SideDrawer = LiquidGlassModal;
export const BottomSheet = LiquidGlassModal;
