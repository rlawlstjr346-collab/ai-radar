"use client";

import { useRef } from "react";

/**
 * 카드 표면 — 무채색 #121215 + 상단 광원 헤어라인(.surface).
 * 마우스 환경((hover: hover))에서는 커서를 따라 반경 280px 의 은은한 흰 반사광(.mouse-glow)이 따라붙는다.
 * 리렌더 없이 CSS 변수(--mouse-x, --mouse-y)만 갱신한다.
 * 선택된 카드는 data-active 로 #1C1C22 + 흰 링(ring-white/30).
 *
 * rgb(카테고리 포인트 색)는 예전 호출부 호환용으로 받기만 하고, 표면 색에는 쓰지 않는다 (색 절제).
 */
export default function Spotlight({
  selected,
  className = "",
  children,
}: {
  rgb?: string;
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-active={selected ? "true" : "false"}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mouse-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--mouse-y", `${e.clientY - r.top}px`);
      }}
      className={`surface group/spot relative overflow-hidden rounded-2xl ${className}`}
    >
      <div aria-hidden className="mouse-glow" />
      {children}
    </div>
  );
}
