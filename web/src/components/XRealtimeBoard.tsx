"use client";

import { ArrowUpRight, Filter, X } from "lucide-react";

import { freshness } from "@/lib/filter";
import { stripHighlightMarks } from "@/lib/highlight";
import type { FeedItem } from "@/lib/types";

interface Props {
  items: FeedItem[];
  selectedId: string | null;
  now: number;
  xOnly: boolean;
  onToggleXOnly: () => void;
  onSelect: (id: string) => void;
}

/**
 * 중앙 피드 상단 전용 보드 — '𝕏 실시간 AI 빌더 & 런칭 이슈'
 * 일반 기사 스트림과 분리해 가로 스크롤 카드로 제공하고, '𝕏 전용 모아보기' 필터와 연동한다.
 */
export default function XRealtimeBoard({ items, selectedId, now, xOnly, onToggleXOnly, onSelect }: Props) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="X 실시간 AI 빌더 및 런칭 이슈"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/65 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="source-badge-x inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-bold tracking-tight">
            <span aria-hidden>𝕏</span>
            <span>실시간</span>
          </span>
          <h2 className="text-[16px] font-bold tracking-[-0.015em] text-fg sm:text-[17px]">
            𝕏 실시간 AI 빌더 &amp; 런칭 이슈
          </h2>
          <span className="t-meta tnum">{items.length}건</span>
        </div>

        <button
          type="button"
          onClick={onToggleXOnly}
          aria-pressed={xOnly}
          className={`press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            xOnly
              ? "source-badge-x"
              : "border border-line-strong bg-canvas text-fg-2 hover:bg-elevated hover:text-fg"
          }`}
        >
          {xOnly ? <X className="h-3.5 w-3.5" aria-hidden /> : <Filter className="h-3.5 w-3.5" aria-hidden />}
          {xOnly ? "𝕏 전용 모아보기 해제" : "𝕏 전용 모아보기"}
        </button>
      </div>

      {!xOnly && (
        <div className="thin-scroll -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1.5">
          {items.slice(0, 12).map((item) => {
            const active = selectedId === item.id;
            const handle = item.author_handle || item.hook_title.match(/^(@[A-Za-z0-9_]+)/)?.[1] || "@X";
            const cleanTitle = item.hook_title.replace(/^@[A-Za-z0-9_]+:\s*/, "");
            const preview = stripHighlightMarks(item.what_ko ?? item.context_ko ?? "");
            const f = freshness(item.published_at ?? item.created_at, now);

            return (
              <button
                key={item.id}
                type="button"
                data-item-id={item.id}
                data-active={active ? "true" : "false"}
                onClick={() => onSelect(item.id)}
                aria-pressed={active}
                className="source-card-x beam relative flex w-[285px] shrink-0 snap-start flex-col justify-between gap-2.5 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-[310px]"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="source-badge-x grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                        𝕏
                      </span>
                      <span className="truncate text-[13.5px] font-semibold text-fg">{handle}</span>
                    </span>
                    {f.label && (
                      <span className="shrink-0 text-[12.5px] tabular-nums text-fg-3">{f.label}</span>
                    )}
                  </div>

                  <p className="line-clamp-2 text-[15.5px] font-semibold leading-[1.42] tracking-[-0.015em] text-fg">
                    {cleanTitle}
                  </p>
                  {preview && (
                    <p className="line-clamp-2 text-[13.5px] leading-[1.55] text-fg-2">
                      {preview}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 text-[12.5px] font-medium text-fg-3">
                  <span>{item.benefit_tag ?? "실시간 빌더 시그널"}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
