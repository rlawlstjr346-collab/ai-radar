"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { easyOriginalSegments, highlightSegments, stripHighlightMarks } from "@/lib/highlight";
import { splitByTerms } from "@/lib/terms";
import type { Entity, Term } from "@/lib/types";

import XLogo from "./XLogo";

/** 툴팁 폭: 루트 글자 크기를 따라 FHD 280px → 4K 약 455px 로 함께 커진다 */
const POPOVER_WIDTH_REM = 17.5;
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

/**
 * 전문용어 점선 밑줄 + 리퀴드 글래스 풀이 툴팁.
 * - 데스크톱: 마우스 오버/키보드 포커스로 열림, 모바일: 탭으로 고정 토글
 * - 카드 링크·모달 안에서도 쓰이므로 트리거는 <span role="button"> 이고, 탭/클릭은 전파를 막아 카드·모달이 열리지 않는다
 * - body 포털 + 매 프레임 위치 동기화로 화면 좌우·상하 잘림을 자동 보정
 */
export function TermTooltip({ term, children }: { term: Term; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const width = popRef.current?.offsetWidth || Math.min(POPOVER_WIDTH_REM * rem, vw - 16);
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

  const toggle = (e: React.SyntheticEvent) => {
    // 카드 링크(전면 ::after)·모달 클릭 핸들러로 번지지 않게
    e.preventDefault();
    e.stopPropagation();
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        data-term={term.term}
        className="term-hint"
        onClick={toggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle(e)}
        onPointerEnter={(e) => e.pointerType !== "touch" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType !== "touch" && !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
      >
        {children}
      </span>
      {/* body 로 포털: 바텀시트(transform) 안에서도 position:fixed 가 화면 기준이 되도록 */}
      {open && createPortal(
        <span
          ref={popRef}
          id={id}
          role="tooltip"
          data-placement={pos?.placement ?? "below"}
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: `min(${POPOVER_WIDTH_REM}rem, calc(100vw - 16px))`,
          }}
          className="term-glass"
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={(e) => e.pointerType !== "touch" && !pinned && setOpen(false)}
        >
          <span className="term-glass-term">{term.term}</span>
          <span className="term-glass-desc">{term.easy}</span>
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
