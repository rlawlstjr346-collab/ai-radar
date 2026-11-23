"use client";

import { useSyncExternalStore } from "react";

import { FONT_SIZE_STORAGE_KEY, parseFontSize, type FontSizeScale } from "@/lib/theme";

const listeners = new Set<() => void>();
const readFontSize = (): FontSizeScale => parseFontSize(document.documentElement.dataset.fontSize);

function setFontSize(size: FontSizeScale) {
  if (size === "large") document.documentElement.dataset.fontSize = "large";
  else delete document.documentElement.dataset.fontSize;
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
  } catch {
    // 저장이 막힌 환경에선 이번 방문 동안만 유지
  }
  listeners.forEach((l) => l());
}

function useFontSize(): FontSizeScale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readFontSize,
    () => "standard",
  );
}

const OPTIONS: Array<{ key: FontSizeScale; label: string }> = [
  { key: "standard", label: "표준" },
  { key: "large", label: "크게" },
];

/** 가+ 글자 크기 토글 (표준 / 크게, localStorage 저장) */
export default function FontSizeToggle({ compact = false }: { compact?: boolean }) {
  const size = useFontSize();

  if (compact) {
    const next: FontSizeScale = size === "large" ? "standard" : "large";
    return (
      <button
        type="button"
        onClick={() => setFontSize(next)}
        aria-pressed={size === "large"}
        aria-label={size === "large" ? "글자 크기 표준으로 되돌리기" : "글자 크기 크게 보기"}
        title="글자 크기 전환 (표준 / 크게)"
        className={`press inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          size === "large" ? "bg-fg text-canvas" : "bg-elevated text-fg-2 hover:text-fg"
        }`}
      >
        가+
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-fg-2">
        <span className="font-bold text-fg" aria-hidden>
          가+
        </span>
        글자 크기
      </span>
      <div role="radiogroup" aria-label="글자 크기" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-elevated p-0.5">
        {OPTIONS.map(({ key, label }) => {
          const active = size === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`글자 크기 ${label}`}
              onClick={() => setFontSize(key)}
              className={`press inline-flex items-center rounded-md px-2 py-1 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-canvas text-fg" : "text-fg-3 hover:text-fg-2"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
