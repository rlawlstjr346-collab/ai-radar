"use client";

import { ArrowUpRight, ChevronRight, Flame, Info } from "lucide-react";

import { formatDate, recentForPlatform } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import { CategoryLine, CategoryTag, DifficultyBadge, PlatformMark, StatusBadge } from "./Badges";

interface Props {
  platform: Platform;
  items: FeedItem[];
  onSelectItem: (id: string) => void;
}

export default function PlatformProfile({ platform, items, onSelectItem }: Props) {
  const recent = recentForPlatform(items, platform.id, 3);

  return (
    <article className="flex flex-col" aria-labelledby={`platform-${platform.id}`}>
      <CategoryLine category={platform.category} />
      <div className="flex flex-col gap-7 px-5 pb-8 pt-5 sm:px-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3 pr-20">
            <PlatformMark platform={platform} fallbackId={platform.id} size="lg" />
            <div className="min-w-0">
              <h2 id={`platform-${platform.id}`} className="truncate text-[21px] font-semibold tracking-[-0.015em] text-zinc-50">
                {platform.name}
              </h2>
              <CategoryTag category={platform.category} />
            </div>
          </div>
          <div>
            <StatusBadge status={platform.collect_status} />
          </div>
          <p className="text-[15px] font-medium leading-relaxed text-zinc-50">{platform.one_liner_ko}</p>
        </header>

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-zinc-100">여기 왜 가봐야 할까요?</h3>
          <p className="prose-ko text-[15px] leading-[1.85] text-[#E4E4E7]">{platform.why_visit_ko}</p>
        </section>

        {platform.access_note && (
          <section className="flex gap-3 rounded-xl border border-sky-300/15 bg-sky-300/[0.04] p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] font-semibold text-sky-200">이용 팁</h3>
              <p className="text-sm leading-relaxed text-sky-50/90">{platform.access_note}</p>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-100">
            <Flame className="h-3.5 w-3.5 text-orange-300" aria-hidden />
            여기서 최근 물어온 소식
          </h3>
          {recent.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {recent.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(i.id)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-zinc-100">{i.hook_title}</span>
                      <span className="mt-1.5 flex items-center gap-3">
                        <DifficultyBadge level={i.difficulty} variant="short" />
                        <span className="font-mono text-[11px] text-zinc-500">{formatDate(i.published_at ?? i.created_at)}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm leading-relaxed text-zinc-400">
              {platform.collect_status === "directory_only"
                ? "여긴 도감 추천 사이트라 소식을 자동으로 물어오진 않아요. 직접 구경 가보시는 걸 추천해요."
                : "아직 여기서 물어온 소식이 없어요. 레이더 요원이 곧 다녀올게요."}
            </p>
          )}
        </section>

        <a
          href={platform.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-zinc-950 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          사이트 구경가기
          <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
        </a>
      </div>
    </article>
  );
}
