"use client";

import { Moon, ScrollText } from "lucide-react";
import { useSyncExternalStore } from "react";

import { parseTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

// 같은 화면에 토글이 둘(사이드바 하단·모바일 상단 바)이라 상태는 <html data-theme> 하나로 공유한다
const listeners = new Set<() => void>();
const readTheme = (): Theme => parseTheme(document.documentElement.dataset.theme);

function setTheme(t: Theme) {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    // 저장이 막힌 환경에선 이번 방문 동안만 유지
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "paper" ? "#FCFCF9" : "#0F0F10");
  listeners.forEach((l) => l());
}

function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readTheme,
    () => "paper",
  );
}

const OPTIONS: Array<{ key: Theme; label: string; Icon: typeof Moon }> = [
  { key: "dark", label: "다크", Icon: Moon },
  { key: "paper", label: "종이", Icon: ScrollText },
];

/** 다크 / 종이 읽기 테마 원클릭 전환 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="읽기 테마" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-elevated p-0.5">
      {OPTIONS.map(({ key, label, Icon }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} 테마`}
            onClick={() => setTheme(key)}
            className={`press inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-canvas text-fg" : "text-fg-3 hover:text-fg-2"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {!compact && label}
          </button>
        );
      })}
    </div>
  );
}
