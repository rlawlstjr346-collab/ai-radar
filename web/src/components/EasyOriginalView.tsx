"use client";

import {
  ArrowUpRight,
  Compass,
  LoaderCircle,
  Quote,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

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
      className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-gray-950 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
  const body = "prose-ko text-[15px] leading-[1.85] text-[#E5E7EB]";

  if (state.phase === "loading") {
    return (
      <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
        <p className="inline-flex items-center gap-2 text-[13px] text-gray-400">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          원문을 처음부터 끝까지 쉽게 풀어 오는 중이에요…
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
    );
  }

  const failure =
    state.phase === "error"
      ? "원본 해설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
      : state.data.status === "unavailable"
        ? state.data.message
        : null;
  if (
    failure !== null ||
    state.phase !== "done" ||
    state.data.status !== "ready"
  ) {
    const message = failure ?? "원본 해설을 불러오지 못했어요.";
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-gray-300">{message}</p>
        </div>
        <OriginalLink url={item.canonical_url} />
      </div>
    );
  }

  const easy = state.data.easy_original;
  return (
    <div className="flex flex-col gap-7">
      {easy.source_note && (
        <p className="font-mono text-[11px] leading-relaxed text-gray-500">
          {easy.source_note}
          {state.data.source === "supabase" && !state.data.cached
            ? " · 방금 생성됨"
            : ""}
        </p>
      )}

      <ol className="flex flex-col gap-7">
        {easy.sections.map((s, i) => (
          <li key={i} className="flex flex-col gap-2">
            <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold text-gray-100">
              <span className="font-mono text-[11px] text-gray-500">
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.heading}
            </h3>
            <TermText text={s.body} terms={item.terms} className={body} />
            {s.quote && (
              <blockquote className="flex gap-2 border-l-2 border-white/15 pl-3 font-mono text-[12px] leading-relaxed text-gray-400">
                <Quote
                  className="mt-0.5 h-3 w-3 shrink-0 text-gray-600"
                  aria-hidden
                />
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
        <section className="flex flex-col gap-2.5 rounded-xl border border-sky-300/15 bg-sky-300/[0.04] p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-sky-200">
            <Compass className="h-4 w-4" aria-hidden />
            실제 원문 링크 들어가실 때 관람 포인트
          </h3>
          <ul className="flex flex-col gap-1.5">
            {easy.watch_points.map((w, i) => (
              <li
                key={i}
                className="flex gap-2 text-[13.5px] leading-relaxed text-sky-50/90"
              >
                <span className="font-mono text-[11px] leading-[1.9] text-sky-300/70">
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
