"use client";

import { ArrowRight, ArrowUpRight, BookOpenText, Lightbulb, Radio, Sparkles, Zap } from "lucide-react";
import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { formatDate } from "@/lib/filter";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryLine, CategoryTag, DifficultyBadge, PlatformBadge } from "./Badges";
import EasyOriginalView from "./EasyOriginalView";
import SegmentedControl from "./SegmentedControl";
import TermText from "./TermText";

type Tab = "summary" | "easy";

interface Props {
  item: FeedItem;
  platform?: Platform;
  onSelectPlatform: (id: string) => void;
  /** 이 기사의 [원본 쉽게 읽기]를 실제로 띄울 수 있는지 — 없으면 대형 유도 버튼을 숨긴다 */
  canReadEasy?: boolean;
}

/** 버튼 위계: primary = 순백 고대비, secondary = 차분한 아웃라인 */
export const BTN_PRIMARY =
  "press group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[14px] font-semibold text-zinc-950 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
export const BTN_SECONDARY =
  "press group inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.07] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

export function OriginalLink({ url, variant }: { url: string; variant: "primary" | "secondary" }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY}>
      원문 보러가기
      <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
    </a>
  );
}

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
        <span className="tnum font-mono text-[11px] text-zinc-500">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function ItemDetail({ item, platform, onSelectPlatform, canReadEasy = true }: Props) {
  const meta = CATEGORY_META[item.category];
  const [tab, setTab] = useState<Tab>("summary");
  const panelId = `detail-${item.id}`;
  const body = "prose-ko text-[15px] leading-[1.85] text-[#E4E4E7]";
  const archived = !item.context_ko && !item.what_ko;

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="flex flex-col gap-7 px-5 pb-8 pt-5 sm:px-6">
        <header className="flex flex-col gap-3">
          {/* 우상단 공유·닫기 버튼 자리 확보 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pr-20">
            <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
            <CategoryTag category={item.category} />
          </div>
          <h2 id={`detail-${item.id}`} className="text-[21px] font-semibold leading-snug tracking-[-0.015em] text-[#FAFAFA]">
            {item.hook_title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <BenefitChip tag={item.benefit_tag} size="md" />
            <DifficultyBadge level={item.difficulty} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-zinc-500">
            <span>원문 {formatDate(item.published_at ?? item.created_at)}</span>
            {item.source_count > 1 && (
              <span className="inline-flex items-center gap-1">
                <Radio className="h-3 w-3" aria-hidden />
                <span className="tnum">{item.source_count}</span>곳에서 동시에 포착
              </span>
            )}
          </p>
        </header>

        <SegmentedControl
          label="읽기 방식"
          value={tab}
          onChange={setTab}
          options={[
            { key: "summary", label: "1분 핵심 요약", Icon: Zap, id: `${panelId}-tab-summary`, controls: `${panelId}-panel-summary` },
            { key: "easy", label: "원본 쉽게 읽기", Icon: BookOpenText, id: `${panelId}-tab-easy`, controls: `${panelId}-panel-easy` },
          ]}
        />

        {tab === "easy" ? (
          <div role="tabpanel" id={`${panelId}-panel-easy`} aria-labelledby={`${panelId}-tab-easy`}>
            <EasyOriginalView item={item} />
          </div>
        ) : (
          <div role="tabpanel" id={`${panelId}-panel-summary`} aria-labelledby={`${panelId}-tab-summary`} className="flex flex-col gap-7">
            {/* 밑줄 안내는 실제로 풀이할 용어가 있을 때만 */}
            {item.terms.length > 0 && !archived && (
              <p className="-mt-3 text-[12px] text-zinc-500">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-400">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은 아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {item.context_ko && (
                  <Section step="01" title="원래는요">
                    <TermText text={item.context_ko} terms={item.terms} className={body} />
                  </Section>
                )}
                {item.what_ko && (
                  <Section step="02" title="무슨 일이냐면요">
                    <TermText text={item.what_ko} terms={item.terms} className={body} />
                    {item.analogy_ko && (
                      <div className="mt-1 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
                        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                        <div className="flex flex-col gap-1">
                          <p className="text-[12px] font-semibold text-amber-200">솔직히 외계어 같죠? 쉽게 비유하자면요!</p>
                          <TermText text={item.analogy_ko} terms={item.terms} className="text-[14.5px] leading-[1.8] text-amber-50/90" />
                        </div>
                      </div>
                    )}
                  </Section>
                )}
                {item.why_ko && (
                  <Section step="03" title="왜 중요할까요?">
                    <TermText text={item.why_ko} terms={item.terms} className={body} />
                  </Section>
                )}
                {item.caveats_ko && (
                  <Section step="04" title="참고할 점">
                    <TermText
                      text={item.caveats_ko}
                      terms={item.terms}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-zinc-300"
                    />
                  </Section>
                )}
              </>
            )}

            {item.entities.length > 0 && (
              <p className="font-mono text-[11.5px] leading-relaxed text-zinc-500" aria-label="등장 키워드">
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="flex flex-col gap-2">
              {canReadEasy ? (
                <>
                  {/* 요약 탭의 주인공: 원본 쉽게 읽기 (외부 이탈보다 먼저) */}
                  <button type="button" onClick={() => setTab("easy")} className={`${BTN_PRIMARY} justify-between text-left`}>
                    <span className="flex min-w-0 items-center gap-3">
                      <BookOpenText className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[11.5px] font-medium text-zinc-500">영어 원문 막막하다면?</span>
                        <span>원본 전체 쉽게 읽기</span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <OriginalLink url={item.canonical_url} variant="secondary" />
                </>
              ) : (
                <OriginalLink url={item.canonical_url} variant="primary" />
              )}
              <button
                type="button"
                disabled
                aria-disabled
                className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] px-4 py-2.5 text-[13px] text-zinc-500"
              >
                <Sparkles className="h-3.5 w-3.5" style={{ color: `rgb(${meta.rgb})` }} aria-hidden />
                내 프로젝트에 이 기술 써볼까?
                <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
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
