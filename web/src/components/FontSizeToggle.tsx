"use client";

import { useRef, useSyncExternalStore } from "react";

import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SIZE_STORAGE_KEY,
  parseFontPercent,
} from "@/lib/theme";

const listeners = new Set<() => void>();

function readPercent(): number {
  if (typeof document === "undefined") return FONT_SCALE_DEFAULT;
  const ds = document.documentElement.dataset.fontPercent;
  if (ds) return parseFontPercent(ds);
  if (document.documentElement.dataset.fontSize === "large") return 120;
  return FONT_SCALE_DEFAULT;
}

function applyPercent(next: number) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(next)));
  document.documentElement.dataset.fontPercent = String(clamped);
  document.documentElement.style.setProperty("--font-scale", String(clamped / 100));
  if (clamped >= 112) document.documentElement.dataset.fontSize = "large";
  else delete document.documentElement.dataset.fontSize;
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clamped));
  } catch {
    // 저장이 막힌 환경에선 이번 방문 동안만 유지
  }
  listeners.forEach((l) => l());
}

function useFontPercent(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readPercent,
    () => FONT_SCALE_DEFAULT,
  );
}

/**
 * Apple iOS Control Center 스타일 가로 글씨 크기 슬라이더 (85% ~ 200%).
 * html 루트 font-size(--font-scale)를 실시간 조절해 전 탭·도감·모달 전체를 동일 비율로 스케일링한다.
 */
export default function FontSizeToggle({ compact = false }: { compact?: boolean }) {
  const percent = useFontPercent();
  const trackRef = useRef<HTMLDivElement>(null);
  const ratio = ((percent - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN)) * 100;

  const updateFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    applyPercent(FONT_SCALE_MIN + t * (FONT_SCALE_MAX - FONT_SCALE_MIN));
  };

  if (compact) {
    return (
      <div className="inline-flex shrink-0 items-center gap-1.5" title={`글자 크기 ${percent}% (더블클릭 시 100% 초기화)`}>
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            updateFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1 || e.pointerType === "touch") {
              updateFromClientX(e.clientX);
            }
          }}
          onDoubleClick={() => applyPercent(FONT_SCALE_DEFAULT)}
          className="ios-slider-track relative flex h-8 w-[124px] cursor-ew-resize select-none items-center justify-between overflow-hidden rounded-full border border-line-strong/75 px-2.5 sm:w-[138px]"
        >
          <div
            aria-hidden
            className="ios-slider-fill pointer-events-none absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-out"
            style={{ width: `${Math.max(8, ratio)}%` }}
          />
          <span className="ios-slider-glyph pointer-events-none relative z-10 text-[11px] font-semibold leading-none" aria-hidden>
            가
          </span>
          <span className="ios-slider-glyph tnum pointer-events-none relative z-10 text-[11px] font-semibold opacity-75" aria-hidden>
            {percent}%
          </span>
          <span className="ios-slider-glyph pointer-events-none relative z-10 text-[16px] font-bold leading-none" aria-hidden>
            가
          </span>
          <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step={1}
            value={percent}
            aria-label="글자 크기 조절 슬라이더 (85%에서 200%)"
            aria-valuetext={`${percent}%`}
            onChange={(e) => applyPercent(Number(e.target.value))}
            className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[0.82rem] font-medium text-fg-2">글자 크기</span>
        <button
          type="button"
          onClick={() => applyPercent(FONT_SCALE_DEFAULT)}
          title={`누르면 기본 크기(${FONT_SCALE_DEFAULT}%)로 초기화`}
          className="tnum rounded px-1.5 py-0.5 text-[0.78rem] font-semibold text-fg-2 transition-colors hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {percent}%
        </button>
      </div>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          updateFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || e.pointerType === "touch") {
            updateFromClientX(e.clientX);
          }
        }}
        onDoubleClick={() => applyPercent(FONT_SCALE_DEFAULT)}
        className="ios-slider-track relative flex h-10 w-full cursor-ew-resize select-none items-center justify-between overflow-hidden rounded-full border border-line-strong/80 px-3.5"
      >
        <div
          aria-hidden
          className="ios-slider-fill pointer-events-none absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-out"
          style={{ width: `${Math.max(8, ratio)}%` }}
        />
        <span className="ios-slider-glyph pointer-events-none relative z-10 text-[12px] font-semibold leading-none" aria-hidden>
          가
        </span>
        <span className="ios-slider-glyph pointer-events-none relative z-10 text-[19px] font-bold leading-none" aria-hidden>
          가
        </span>
        <input
          type="range"
          min={FONT_SCALE_MIN}
          max={FONT_SCALE_MAX}
          step={1}
          value={percent}
          aria-label="글자 크기 조절 슬라이더 (85%에서 200%)"
          aria-valuetext={`${percent}%`}
          onChange={(e) => applyPercent(Number(e.target.value))}
          className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  );
}
