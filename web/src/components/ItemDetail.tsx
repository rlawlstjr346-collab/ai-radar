"use client";

import { ArrowRight, ArrowUpRight, BookOpenText, Flame, Pin, Radio, Sparkles, Target, Zap } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { formatDate } from "@/lib/filter";
import { getHighlightSummary, getUtilityInsight } from "@/lib/reading-insights";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryLine, CategoryTag, DifficultyBadge, PlatformMark } from "./Badges";
import EasyOriginalView from "./EasyOriginalView";
import { isXItem } from "./ItemCard";
import ProjectGuide from "./ProjectGuide";
import SegmentedControl from "./SegmentedControl";
import TermText from "./TermText";
import XLogo from "./XLogo";

type Tab = "summary" | "easy";

interface Props {
  item: FeedItem;
  platform?: Platform;
  onSelectPlatform: (id: string) => void;
  canReadEasy?: boolean;
}

export const BTN_PRIMARY =
  "press group inline-flex h-auto items-center justify-center gap-2.5 rounded-2xl bg-fg px-5 py-4 text-[16px] font-semibold leading-[1.35] text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const BTN_SECONDARY =
  "press group inline-flex h-auto items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface/85 px-5 py-3.5 text-[15.5px] font-medium leading-[1.35] text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function OriginalLink({ url, variant }: { url: string; variant: "primary" | "secondary" }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY}>
      원문 보러가기
      <ArrowUpRight className="h-[18px] w-[18px] transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
    </a>
  );
}

function staggerStyle(index: number): CSSProperties {
  return { "--stagger": index } as CSSProperties;
}

/** iOS 건강(Health) 앱 스타일 — 화이트 인셋 카드 + 컬러 포인트 소제목 라벨 */
function HealthInsetCard({
  label,
  labelColorClass,
  Icon,
  staggerIndex,
  children,
}: {
  label: string;
  labelColorClass: string;
  Icon: typeof Sparkles;
  staggerIndex: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="inset-health-card reading-stagger flex flex-col gap-3 p-6"
      style={staggerStyle(staggerIndex)}
    >
      <h3 className={`flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em] ${labelColorClass}`}>
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden />
        <span>{label}</span>
      </h3>
      {children}
    </section>
  );
}

export default function ItemDetail({ item, platform, onSelectPlatform, canReadEasy = true }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const panelId = `detail-${item.id}`;
  const body = "prose-ko t-body";
  const archived = !item.context_ko && !item.what_ko;

  const hasAltOriginalTitle = Boolean(item.original_title && item.original_title.trim() !== item.hook_title.trim());
  const highlightSummary = getHighlightSummary(item);
  const utility = getUtilityInsight(item, platform?.name);
  const xCard = isXItem(item);
  const platformName = platform?.name ?? item.platform_id;

  // '어디에 써야할까요' 1~2줄 간결 합성 (중복 없이 실전 효용 + 바로 써볼 팁)
  const whereToUseText = `${utility.when_needed} — ${utility.work_utility}`;

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="mx-auto flex w-full max-w-[74ch] flex-col gap-6 px-7 pb-12 pt-3 sm:px-10">
        <header className="reading-stagger flex flex-col gap-3.5" style={staggerStyle(0)}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[15px]">
            <button
              type="button"
              onClick={() => onSelectPlatform(xCard ? "x" : item.platform_id)}
              className="press inline-flex max-w-full items-center gap-1.5 rounded-full bg-elevated px-3.5 py-1.5 text-[14.5px] font-bold text-fg transition-colors hover:bg-fg hover:text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {xCard ? (
                <>
                  <XLogo className="h-4 w-4 shrink-0" />
                  <span className="truncate">𝕏 실시간{item.author_handle ? ` · ${item.author_handle}` : ""}</span>
                </>
              ) : (
                <>
                  <PlatformMark platform={platform} fallbackId={item.platform_id} size="xs" />
                  <span className="truncate">{platformName}</span>
                </>
              )}
            </button>
            <CategoryTag category={item.category} />
            <span className="text-[14.5px] text-fg-3">· 원문 {formatDate(item.published_at ?? item.created_at)}</span>
            {item.source_count > 1 && (
              <span className="inline-flex items-center gap-1 text-[14.5px] text-fg-3">
                <Radio className="h-4 w-4" aria-hidden />
                <span className="tnum">{item.source_count}</span>곳 포착
              </span>
            )}
          </div>

          <h2 id={`detail-${item.id}`} className="t-panel-title">
            {item.hook_title}
          </h2>

          {/* 원문 제목은 모달 상단에 작게 병기 */}
          {hasAltOriginalTitle && (
            <p className="-mt-1 text-[15px] leading-snug text-fg-3">
              원문: {item.original_title}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <BenefitChip tag={item.benefit_tag} size="md" />
            <DifficultyBadge level={item.difficulty} />
          </div>
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
          <div role="tabpanel" id={`${panelId}-panel-easy`} aria-labelledby={`${panelId}-tab-easy`} className="animate-article-enter">
            <EasyOriginalView item={item} />
          </div>
        ) : (
          <div role="tabpanel" id={`${panelId}-panel-summary`} aria-labelledby={`${panelId}-tab-summary`} className="flex flex-col gap-4">
            {item.terms.length > 0 && !archived && (
              <p className="px-1 text-[14px] text-fg-3">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="inset-health-card p-6 text-[16.5px] leading-relaxed text-fg-2">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은 아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {/* ① ✨ 1분 핵심요약 (앰버 골드 포인트 #D97706 + 소프트 형광펜) */}
                {highlightSummary && (
                  <HealthInsetCard
                    label="1분 핵심요약"
                    labelColorClass="text-[#D97706] [:root[data-theme=dark]_&]:text-[#FBBF24]"
                    Icon={Sparkles}
                    staggerIndex={1}
                  >
                    <TermText
                      text={highlightSummary}
                      terms={item.terms}
                      entities={item.entities}
                      className={`${body} font-medium`}
                      highlight
                    />
                  </HealthInsetCard>
                )}

                {/* ② 🎯 어디에 써야할까요 (애플 블루 포인트 #007AFF) */}
                <HealthInsetCard
                  label="어디에 써야할까요"
                  labelColorClass="text-[#007AFF] [:root[data-theme=dark]_&]:text-[#38BDF8]"
                  Icon={Target}
                  staggerIndex={2}
                >
                  <p className={body}>{whereToUseText}</p>
                  <p className="border-t border-line pt-3 text-[15.5px] leading-[1.65] text-fg-2">
                    <span className="font-semibold text-fg">실전 팁:</span> {utility.practical_tip}
                  </p>
                </HealthInsetCard>

                {/* ③ 📌 무슨 일이냐면요 (애플 인디고 포인트 #5856D6) */}
                {item.what_ko && (
                  <HealthInsetCard
                    label="무슨 일이냐면요"
                    labelColorClass="text-[#5856D6] [:root[data-theme=dark]_&]:text-[#818CF8]"
                    Icon={Pin}
                    staggerIndex={3}
                  >
                    <TermText text={item.what_ko} terms={item.terms} entities={item.entities} className={body} />
                    {item.analogy_ko && (
                      <blockquote className="mt-1 border-l-2 border-line-strong pl-4 text-[16px] leading-[1.65] text-fg-2">
                        <span className="font-semibold text-fg">쉽게 비유하자면: </span>
                        {item.analogy_ko}
                      </blockquote>
                    )}
                  </HealthInsetCard>
                )}

                {/* ④ 🔥 왜 중요할까요 (애플 오렌지 포인트 #FF9500) */}
                {item.why_ko && (
                  <HealthInsetCard
                    label="왜 중요할까요"
                    labelColorClass="text-[#FF9500] [:root[data-theme=dark]_&]:text-[#FB923C]"
                    Icon={Flame}
                    staggerIndex={4}
                  >
                    <TermText text={item.why_ko} terms={item.terms} entities={item.entities} className={body} />
                  </HealthInsetCard>
                )}
              </>
            )}

            {item.entities.length > 0 && (
              <p className="t-meta reading-stagger px-1 pt-1 leading-relaxed" style={staggerStyle(5)} aria-label="등장 키워드">
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="reading-stagger flex flex-col gap-3 pt-1" style={staggerStyle(6)}>
              {canReadEasy ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTab("easy")}
                    className={`${BTN_PRIMARY} sheen relative h-auto w-full justify-between overflow-hidden px-5 py-4 text-left`}
                  >
                    <span className="flex min-w-0 items-center gap-3.5">
                      <BookOpenText className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-col gap-1 leading-[1.35]">
                        <span className="text-[13.5px] font-medium leading-[1.35] opacity-80">
                          원문 전체를 매거진처럼 깊이 읽고 싶다면?
                        </span>
                        <span className="text-[16.5px] font-bold leading-[1.35]">원본 전체 쉽게 읽기</span>
                      </span>
                    </span>
                    <ArrowRight className="h-5 w-5 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <OriginalLink url={item.canonical_url} variant="secondary" />
                </>
              ) : (
                <OriginalLink url={item.canonical_url} variant="primary" />
              )}
              <ProjectGuide item={item} platformName={platform?.name} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
