"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { createPortal } from "react-dom";

import { easyOriginalSegments, highlightSegments, stripHighlightMarks } from "@/lib/highlight";
import { splitByTerms } from "@/lib/terms";
import type { Entity, Term } from "@/lib/types";

import XLogo from "./XLogo";

const POPOVER_WIDTH = 280;
const GAP = 8;
const MATH_X_GLYPH = "\uD835\uDD4F"; // 𝕏 (U+1D54F)

/**
 * 수학 기호 𝕏(U+1D54F)는 리눅스에서 Math 폴백 폰트로 떨어져 드래그 선택 영역이 위로 2~3배 팽창한다.
 * 모든 𝕏 문자를 고정 높이(1em) 인라인 SVG 래퍼로 격리해 일반 한글·영문 줄과 드래그 높이를 1px 오차 없이 맞춘다.
 */
export function renderSafeX(text: string): React.ReactNode {
  if (!text || !text.includes(MATH_X_GLYPH)) return text;
  const parts = text.split(MATH_X_GLYPH);
  return parts.map((part, idx) => (
    <span key={idx}>
      {part}
      {idx < parts.length - 1 && (
        <span className="x-glyph-inline" aria-label="X">
          <XLogo className="h-[0.86em] w-[0.86em]" />
        </span>
      )}
    </span>
  ));
}

export function SafeXText({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{renderSafeX(text)}</span>;
}

/** 외계어 밑줄 + 풀이 팝오버. 데스크톱은 마우스 오버/포커스, 모바일은 탭으로 연다. */
export function TermTooltip({ term, children }: { term: Term; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(POPOVER_WIDTH, vw - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, vw - width - 8));
    const popH = popRef.current?.offsetHeight ?? 110;
    const below = r.bottom + GAP + popH < window.innerHeight || r.top < popH + GAP;
    const next = { top: below ? r.bottom + GAP : r.top - GAP - popH, left, placement: below ? "below" : "above" } as const;
    setPos((prev) =>
      prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && prev.placement === next.placement
        ? prev
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    // 열려 있는 동안 매 프레임 위치 동기화 — 바텀시트 슬라이드/드래그/스크롤 중에도 단어에 붙어 있게
    let raf = 0;
    const tick = () => {
      place();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          // 탭/클릭: 고정(pinned) 토글. 고정되면 마우스가 떠나도 유지
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
        onPointerEnter={(e) => e.pointerType !== "touch" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType !== "touch" && !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        className="inline cursor-help rounded-sm text-inherit underline decoration-fg-3 decoration-dotted decoration-[1.5px] underline-offset-[5px] transition-colors duration-100 hover:bg-elevated hover:decoration-accent focus-visible:bg-elevated focus-visible:decoration-accent focus-visible:outline-none"
      >
        {children}
      </button>
      {/* body 로 포털: 바텀시트(transform) 안에서도 position:fixed 가 화면 기준이 되도록 */}
      {open && createPortal(
        <span
          ref={popRef}
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: `min(${POPOVER_WIDTH}px, calc(100vw - 16px))`,
          }}
          className="animate-fade-in z-[80] block select-none rounded-lg bg-fg p-3.5 text-left"
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={(e) => e.pointerType !== "touch" && !pinned && setOpen(false)}
        >
          <span className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-canvas opacity-75">
            <Languages className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /> 외계어 번역기 · {term.term}
          </span>
          <span className="block text-[14px] font-normal leading-relaxed text-canvas">{term.easy}</span>
        </span>,
        document.body,
      )}
    </>
  );
}

/**
 * 본문 문단 — terms 에 있는 단어에 툴팁 점선 밑줄을 자동으로 단다.
 * - mode="default": highlight=true 면 형광펜(.hl-mark) + 고유명사 칩(.hl-entity)
 * - mode="easy": 원본 쉽게 읽기 전용 스마트 볼드(<strong>, 카드당 첫 등장 1회) + enableMark 섹션 결론 1문장 소프트 형광펜(<mark>)
 */
export default function TermText({
  text,
  terms,
  className,
  highlight = false,
  mode = "default",
  enableMark = false,
  entities = [],
}: {
  text: string;
  terms: Term[];
  className?: string;
  highlight?: boolean;
  mode?: "default" | "easy";
  enableMark?: boolean;
  entities?: Entity[];
}) {
  if (mode === "easy") {
    const segments = easyOriginalSegments(text, terms, entities, { enableMark });
    return (
      <p className={className}>
        {segments.map((s, i) =>
          s.term ? (
            <TermTooltip key={i} term={s.term}>
              {renderSafeX(s.text)}
            </TermTooltip>
          ) : s.hl ? (
            <mark key={i} className="hl-mark">
              {renderSafeX(s.text)}
            </mark>
          ) : s.bold ? (
            <strong key={i} className="easy-bold">
              {renderSafeX(s.text)}
            </strong>
          ) : (
            <span key={i}>{renderSafeX(s.text)}</span>
          ),
        )}
      </p>
    );
  }

  const segments = highlight ? highlightSegments(text, terms, true, entities) : splitByTerms(stripHighlightMarks(text), terms);
  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.term ? (
          <TermTooltip key={i} term={s.term}>
            {renderSafeX(s.text)}
          </TermTooltip>
        ) : "hl" in s && s.hl ? (
          <mark key={i} className="hl-mark">
            {renderSafeX(s.text)}
          </mark>
        ) : "entity" in s && s.entity ? (
          <span key={i} className="hl-entity">
            {renderSafeX(s.text)}
          </span>
        ) : (
          <span key={i}>{renderSafeX(s.text)}</span>
        ),
      )}
    </p>
  );
}
