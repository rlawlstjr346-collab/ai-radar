"use client";

import { useRef } from "react";

/**
 * 마우스 위치를 따라 카테고리 포인트 컬러가 은은하게 비치는 스포트라이트 표면 (Magic UI 스타일).
 * 리렌더 없이 CSS 변수(--mx, --my)만 갱신한다.
 */
export default function Spotlight({
  rgb,
  selected,
  className = "",
  children,
}: {
  rgb: string;
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      style={
        {
          "--cat": rgb,
          borderColor: selected ? `rgba(${rgb},0.45)` : undefined,
        } as React.CSSProperties
      }
      className={`group/spot relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1520] transition-[border-color,transform,background-color] duration-300 hover:-translate-y-px hover:border-[rgba(var(--cat),0.32)] ${
        selected ? "bg-[#121a27]" : ""
      } ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
        style={{
          background: "radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), rgba(var(--cat),0.10), transparent 65%)",
        }}
      />
      {selected && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px circle at 0% 0%, rgba(var(--cat),0.08), transparent 60%)" }}
        />
      )}
      {children}
    </div>
  );
}
