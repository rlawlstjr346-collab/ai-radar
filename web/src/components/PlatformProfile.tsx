"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";

import { formatDate, recentForPlatform } from "@/lib/filter";
import { REGION_META, regionOf } from "@/lib/regions";
import type { FeedItem, Platform } from "@/lib/types";

import { CategoryLine, CategoryTag, DifficultyBadge, PlatformMark, StatusBadge } from "./Badges";
import { BTN_PRIMARY } from "./ItemDetail";

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
      <div className="mx-auto flex w-full max-w-[74ch] flex-col gap-7 px-7 pb-12 pt-4 sm:px-10 sm:pt-5">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3 pr-20">
            <PlatformMark platform={platform} fallbackId={platform.id} size="lg" />
            <div className="min-w-0">
              <h2 id={`platform-${platform.id}`} className="t-panel-title truncate">
                {platform.name}
              </h2>
              <CategoryTag category={platform.category} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={platform.collect_status} />
            <span className="text-[0.82rem] text-fg-3">
              {REGION_META[regionOf(platform)].flag} {REGION_META[regionOf(platform)].filter}
            </span>
          </div>
          <p className="text-[1rem] leading-relaxed text-fg-2">{platform.one_liner_ko}</p>
        </header>

        <section className="inset-health-card flex flex-col gap-2 p-5">
          <h3 className="text-[0.85rem] font-bold text-fg-3">여기 왜 가봐야 할까요?</h3>
          <p className="t-body">{platform.why_visit_ko}</p>
        </section>

        {platform.access_note && (
          <section className="inset-health-card flex flex-col gap-1.5 p-5">
            <h3 className="text-[0.85rem] font-bold text-[#007AFF] [:root[data-theme=dark]_&]:text-[#38BDF8]">이용 팁</h3>
            <p className="t-body text-fg">{platform.access_note}</p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-[0.85rem] font-bold text-fg-3">여기서 최근 물어온 소식</h3>
          {recent.length > 0 ? (
            <ul className="-mx-3 flex flex-col">
              {recent.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(i.id)}
                    className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-100 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-fg">{i.hook_title}</span>
                      <span className="mt-1.5 flex items-center gap-3">
                        <DifficultyBadge level={i.difficulty} variant="short" />
                        <span className="t-meta">{formatDate(i.published_at ?? i.created_at)}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-3 group-hover:text-fg" strokeWidth={1.8} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="inset-health-card px-4 py-3 text-[0.92rem] leading-relaxed text-fg-2">
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
          className={BTN_PRIMARY}
        >
          사이트 구경가기
          <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
        </a>
      </div>
    </article>
  );
}
