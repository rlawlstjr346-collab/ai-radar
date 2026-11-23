"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  Icon?: LucideIcon;
  /** 옆에 작게 붙는 숫자 (고정폭) */
  count?: number;
  /** 탭 패널 연결용 id (role="tablist" 일 때) */
  controls?: string;
  id?: string;
}

/**
 * 슬라이딩 필(Sliding Pill) 세그먼트 컨트롤.
 * 선택 배경이 끊기지 않고 옆으로 미끄러진다(iOS 감속 곡선, globals.css .sliding-pill).
 * 버튼 폭이 서로 달라도 실제 크기를 재서 맞춘다 (ResizeObserver).
 */
export default function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  label,
  role = "tablist",
  stretch = true,
  className = "",
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  role?: "tablist" | "radiogroup";
  /** true: 칸을 균등 분할 / false: 내용 폭만큼 (가로 스크롤 가능) */
  stretch?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef(new Map<K, HTMLButtonElement>());
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current.get(value);
      if (!btn) return;
      setPill({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [value, options.length]);

  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <div
      ref={wrapRef}
      role={role}
      aria-label={label}
      className={`relative flex min-w-0 gap-1 rounded-lg bg-elevated p-1 ${
        stretch ? "" : "thin-scroll overflow-x-auto"
      } ${className}`}
    >
      {pill && (
        <span
          aria-hidden
          className="sliding-pill pointer-events-none absolute bottom-1 left-0 top-1 rounded-md bg-canvas"
          style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
        />
      )}
      {options.map(({ key, label: text, Icon, count, controls, id }) => {
        const active = key === value;
        return (
          <button
            key={key}
            ref={(el) => {
              if (el) btnRefs.current.set(key, el);
              else btnRefs.current.delete(key);
            }}
            type="button"
            role={itemRole}
            id={id}
            aria-controls={controls}
            {...(role === "tablist" ? { "aria-selected": active } : { "aria-checked": active })}
            onClick={() => onChange(key)}
            className={`press relative z-10 inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-[15.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              stretch ? "flex-1" : "shrink-0"
            } ${active ? "font-semibold text-fg" : "text-fg-2 hover:text-fg"}`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />}
            <span className="truncate">{text}</span>
            {count !== undefined && <span className="tnum text-[13.5px] text-fg-3">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
