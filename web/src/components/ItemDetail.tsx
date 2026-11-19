"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Lightbulb,
  Radio,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { formatDate } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import {
  BenefitChip,
  CategoryLine,
  CategoryTag,
  DifficultyBadge,
  PlatformBadge,
} from "./Badges";
import EasyOriginalView from "./EasyOriginalView";
import TermText from "./TermText";

type Tab = "summary" | "easy";

interface Props {
  item: FeedItem;
  platform?: Platform;
  onSelectPlatform: (id: string) => void;
}

function Section({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-gray-100">
        <span className="font-mono text-[11px] text-gray-500">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SegmentTabs({
  tab,
  onTab,
  id,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  id: string;
}) {
  const tabs: Array<{ key: Tab; label: string; Icon: typeof Zap }> = [
    { key: "summary", label: "1분 핵심 요약", Icon: Zap },
    { key: "easy", label: "원본 쉽게 읽기", Icon: BookOpenText },
  ];
  return (
    <div
      role="tablist"
      aria-label="읽기 방식"
      className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
    >
      {tabs.map(({ key, label, Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-tab-${key}`}
            aria-selected={active}
            aria-controls={`${id}-panel-${key}`}
            onClick={() => onTab(key)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
              active
                ? "bg-white/[0.09] text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 ${active ? "text-emerald-300" : ""}`}
              aria-hidden
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function ItemDetail({
  item,
  platform,
  onSelectPlatform,
}: Props) {
  const meta = CATEGORY_META[item.category];
  const [tab, setTab] = useState<Tab>("summary");
  const panelId = `detail-${item.id}`;
  const body = "prose-ko text-[15px] leading-[1.85] text-[#E5E7EB]";
  const archived = !item.context_ko && !item.what_ko;

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="flex flex-col gap-7 px-5 pb-8 pt-5 sm:px-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pr-8">
            <PlatformBadge
              platform={platform}
              fallbackId={item.platform_id}
              onSelect={onSelectPlatform}
            />
            <CategoryTag category={item.category} />
          </div>
          <h2
            id={`detail-${item.id}`}
            className="text-[21px] font-semibold leading-snug tracking-[-0.015em] text-white"
          >
            {item.hook_title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <BenefitChip tag={item.benefit_tag} size="md" />
            <DifficultyBadge level={item.difficulty} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-gray-500">
            <span>{formatDate(item.published_at ?? item.created_at)}</span>
            {item.source_count > 1 && (
              <span className="inline-flex items-center gap-1">
                <Radio className="h-3 w-3" aria-hidden />
                {item.source_count}곳에서 동시에 포착
              </span>
            )}
          </p>
          {item.terms.length > 0 && (
            <p className="text-[12px] text-gray-500">
              점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.
            </p>
          )}
        </header>

        <SegmentTabs tab={tab} onTab={setTab} id={panelId} />

        {tab === "easy" ? (
          <div
            role="tabpanel"
            id={`${panelId}-panel-easy`}
            aria-labelledby={`${panelId}-tab-easy`}
          >
            <EasyOriginalView item={item} />
          </div>
        ) : (
          <div
            role="tabpanel"
            id={`${panelId}-panel-summary`}
            aria-labelledby={`${panelId}-tab-summary`}
            className="flex flex-col gap-7"
          >
            {archived ? (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm leading-relaxed text-gray-400">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은
                아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {item.context_ko && (
                  <Section step="01" title="원래는요">
                    <TermText
                      text={item.context_ko}
                      terms={item.terms}
                      className={body}
                    />
                  </Section>
                )}
                {item.what_ko && (
                  <Section step="02" title="무슨 일이냐면요">
                    <TermText
                      text={item.what_ko}
                      terms={item.terms}
                      className={body}
                    />
                    {item.analogy_ko && (
                      <div className="mt-1 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
                        <Lightbulb
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                          aria-hidden
                        />
                        <div className="flex flex-col gap-1">
                          <p className="text-[12px] font-semibold text-amber-200">
                            솔직히 외계어 같죠? 쉽게 비유하자면요!
                          </p>
                          <TermText
                            text={item.analogy_ko}
                            terms={item.terms}
                            className="text-[14.5px] leading-[1.8] text-amber-50/90"
                          />
                        </div>
                      </div>
                    )}
                  </Section>
                )}
                {item.why_ko && (
                  <Section step="03" title="왜 중요할까요?">
                    <TermText
                      text={item.why_ko}
                      terms={item.terms}
                      className={body}
                    />
                  </Section>
                )}
                {item.caveats_ko && (
                  <Section step="04" title="참고할 점">
                    <TermText
                      text={item.caveats_ko}
                      terms={item.terms}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-gray-300"
                    />
                  </Section>
                )}
              </>
            )}

            {item.entities.length > 0 && (
              <p
                className="font-mono text-[11.5px] leading-relaxed text-gray-500"
                aria-label="등장 키워드"
              >
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setTab("easy")}
                className="group flex items-center gap-3 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-4 py-3.5 text-left transition hover:border-emerald-300/45 hover:bg-emerald-300/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              >
                <BookOpenText
                  className="h-5 w-5 shrink-0 text-emerald-300"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[12px] text-emerald-200/80">
                    영어 원문 막막하다면?
                  </span>
                  <span className="text-[14px] font-semibold text-white">
                    원본 전체 쉽게 읽기
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-emerald-300 transition group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
              <a
                href={item.canonical_url}
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
              <button
                type="button"
                disabled
                aria-disabled
                className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] px-4 py-2.5 text-[13px] text-gray-400"
              >
                <Sparkles
                  className="h-3.5 w-3.5"
                  style={{ color: `rgb(${meta.rgb})` }}
                  aria-hidden
                />
                내 프로젝트에 이 기술 써볼까?
                <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-gray-400">
                  Coming Soon
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
