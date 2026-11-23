"use client";

import { ArrowUpRight, BookOpenText, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { synthesizeEasyOriginal } from "@/lib/easy-synth";
import type { EasyOriginalResponse, FeedItem } from "@/lib/types";

import TermText from "./TermText";

/** 같은 기사를 다시 열 때 다시 받지 않도록 탭 전환 간 메모리 캐시 */
const memo = new Map<string, EasyOriginalResponse>();

type State =
  | { phase: "loading" }
  | { phase: "done"; data: EasyOriginalResponse }
  | { phase: "error" };

function useEasyOriginal(id: string): State {
  const [state, setState] = useState<State>(() => {
    const hit = memo.get(id);
    return hit ? { phase: "done", data: hit } : { phase: "loading" };
  });

  useEffect(() => {
    if (memo.has(id)) return;
    const ctrl = new AbortController();
    fetch(`/api/items/${encodeURIComponent(id)}/easy-original`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as EasyOriginalResponse;
        if (data.status === "ready") memo.set(id, data);
        setState({ phase: "done", data });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError")
          setState({ phase: "error" });
      });
    return () => ctrl.abort();
  }, [id]);

  return state;
}

function OriginalLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="press group inline-flex items-center justify-center gap-2 rounded-2xl bg-fg px-5 py-3.5 text-[0.95rem] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      원문 보러가기
      <ArrowUpRight
        className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px"
        aria-hidden
      />
    </a>
  );
}

export default function EasyOriginalView({ item }: { item: FeedItem }) {
  const state = useEasyOriginal(item.id);
  const body = "prose-ko t-body";

  if (state.phase === "loading") {
    return (
      <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
        <p className="inline-flex items-center gap-2 text-[0.88rem] text-fg-2">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          원문을 처음부터 끝까지 쉽게 풀어 오는 중이에요…
        </p>
        {/* 문단 모양 쉬머 스켈레톤 (제목 한 줄 + 본문 서너 줄 + 인용 한 줄) */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <div className="shimmer h-3.5 w-2/5 rounded" />
            <div className="shimmer h-3 w-full rounded" />
            <div className="shimmer h-3 w-[96%] rounded" />
            <div className="shimmer h-3 w-[88%] rounded" />
            {i !== 2 && <div className="shimmer h-3 w-3/5 rounded" />}
            <div className="mt-1 h-3 w-1/2 border-l-2 border-line-strong pl-3">
              <div className="shimmer h-full w-full rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 요청이 실패하거나(오프라인·서버 오류) 해설이 없다는 응답이 와도 실패 화면 대신
  // 그 기사의 검증된 요약으로 완독 가이드를 바로 합성해 보여 준다 (lib/easy-synth.ts)
  const easy =
    state.phase === "done" && state.data.status === "ready" ? state.data.easy_original : synthesizeEasyOriginal(item);
  // 분량 가이드: 한국어 평균 읽기 속도 약 500자/분
  const chars = easy.sections.reduce((n, s) => n + s.heading.length + s.body.length, 0);
  const minutes = Math.max(1, Math.round(chars / 500));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3.5">
        <p className="t-meta inline-flex items-center gap-2 font-medium text-fg-2">
          <BookOpenText className="h-4 w-4 text-fg" strokeWidth={2} aria-hidden />
          매거진 완독 해설 · 총 <span className="tnum font-semibold text-fg">{easy.sections.length}</span>문단 · 약{" "}
          <span className="tnum font-semibold text-fg">{minutes}</span>분 완독
        </p>
        <span className="tnum text-[0.84rem] font-medium text-fg-3">
          {chars.toLocaleString("ko-KR")}자
        </span>
      </div>
      {easy.source_note && (
        <p className="t-meta -mt-3 leading-relaxed">
          {easy.source_note}
          {state.phase === "done" &&
          state.data.status === "ready" &&
          state.data.source === "supabase" &&
          !state.data.cached &&
          !state.data.synthesized
            ? " · 방금 생성됨"
            : ""}
        </p>
      )}

      <ol className="flex flex-col gap-4">
        {easy.sections.map((s, i) => (
          <li
            key={i}
            className="inset-health-card reading-stagger flex flex-col gap-3 p-6"
            style={{ "--stagger": i + 1 } as React.CSSProperties}
          >
            <h3 className="flex items-baseline gap-2.5 text-[19px] font-bold leading-snug text-heading">
              <span className="tnum shrink-0 text-[14.5px] font-semibold text-fg-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{s.heading}</span>
            </h3>
            <TermText text={s.body} terms={item.terms} entities={item.entities} className={body} />
            {s.quote && (
              <blockquote className="mt-1 border-l-2 border-line-strong py-1 pl-4 text-[16px] italic leading-relaxed text-fg-2">
                <span>
                  <span className="sr-only">원문 인용: </span>
                  {s.quote}
                </span>
              </blockquote>
            )}
          </li>
        ))}
      </ol>

      {easy.watch_points.length > 0 && (
        <section className="inset-health-card flex flex-col gap-3 p-6">
          <h3 className="text-[15px] font-bold text-[#007AFF] [:root[data-theme=dark]_&]:text-[#38BDF8]">
            실제 원문 링크 들어가실 때 관람 포인트
          </h3>
          <ul className="flex flex-col gap-2">
            {easy.watch_points.map((w, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-[16.5px] leading-[1.7] text-fg"
              >
                <span className="tnum text-[14.5px] leading-[1.95] text-fg-3">
                  {i + 1}
                </span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OriginalLink url={item.canonical_url} />
    </div>
  );
}
