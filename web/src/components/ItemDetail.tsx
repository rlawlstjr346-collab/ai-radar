"use client";

import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Compass,
  Highlighter,
  Info,
  Languages,
  Lightbulb,
  Radio,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState, type CSSProperties } from "react";

import { formatDate } from "@/lib/filter";
import { getHighlightSummary, getUtilityInsight } from "@/lib/reading-insights";
import { sourceVisualFor } from "@/lib/source-style";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryLine, CategoryTag, DifficultyBadge, PlatformBadge } from "./Badges";
import EasyOriginalView from "./EasyOriginalView";
import ProjectGuide from "./ProjectGuide";
import SegmentedControl from "./SegmentedControl";
import TermText from "./TermText";

type Tab = "summary" | "easy";

interface Props {
  item: FeedItem;
  platform?: Platform;
  onSelectPlatform: (id: string) => void;
  canReadEasy?: boolean;
}

export const BTN_PRIMARY =
  "press group inline-flex items-center justify-center gap-2 rounded-xl bg-fg px-4 py-3.5 text-[15px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const BTN_SECONDARY =
  "press group inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-[14.5px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function OriginalLink({ url, variant }: { url: string; variant: "primary" | "secondary" }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY}>
      원문 보러가기
      <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
    </a>
  );
}

function staggerStyle(index: number): CSSProperties {
  return { "--stagger": index } as CSSProperties;
}

/** 3포인트 구조화 브리핑 카드 안의 스캔형 블록 */
function BriefingPoint({
  badge,
  badgeClass,
  Icon,
  children,
}: {
  badge: string;
  badgeClass: string;
  Icon: typeof Info;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-line/70 pb-4 last:border-b-0 last:pb-0">
      <h3 className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-bold ${badgeClass}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
          {badge}
        </span>
      </h3>
      {children}
    </div>
  );
}

export default function ItemDetail({ item, platform, onSelectPlatform, canReadEasy = true }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [showOriginalTitle, setShowOriginalTitle] = useState(false);
  const panelId = `detail-${item.id}`;
  const body = "prose-ko t-body";
  const archived = !item.context_ko && !item.what_ko;

  const hasAltOriginalTitle = Boolean(item.original_title && item.original_title.trim() !== item.hook_title.trim());
  const highlightSummary = getHighlightSummary(item);
  const utility = getUtilityInsight(item, platform?.name);
  const visual = sourceVisualFor(item.platform_id, platform);

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-6 px-5 pb-12 pt-4 sm:px-7 sm:pt-5">
        <header className="reading-stagger flex flex-col gap-3" style={staggerStyle(0)}>
          <div className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className={`${visual.badgeClass} inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-bold`}>
              {visual.group === "x" ? "𝕏 실시간" : visual.label}
            </span>
            <span className="-ml-0.5">
              <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
            </span>
            {item.platform_id === "x" && item.author_handle && (
              <span className="font-semibold text-fg">{item.author_handle}</span>
            )}
            <span aria-hidden>·</span>
            <CategoryTag category={item.category} />
          </div>

          <h2 id={`detail-${item.id}`} className="t-panel-title">
            {showOriginalTitle && hasAltOriginalTitle ? item.original_title : item.hook_title}
          </h2>

          {hasAltOriginalTitle && (
            <div>
              <button
                type="button"
                onClick={() => setShowOriginalTitle((v) => !v)}
                className="press inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1 text-[13px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Languages className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {showOriginalTitle ? "한국어 제목 보기" : "원문 제목 보기"}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <BenefitChip tag={item.benefit_tag} size="md" />
            <DifficultyBadge level={item.difficulty} />
          </div>

          <p className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>원문 {formatDate(item.published_at ?? item.created_at)}</span>
            {item.source_count > 1 && (
              <span className="inline-flex items-center gap-1">
                <Radio className="h-3.5 w-3.5" aria-hidden />
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
          <div role="tabpanel" id={`${panelId}-panel-easy`} aria-labelledby={`${panelId}-tab-easy`} className="animate-article-enter">
            <EasyOriginalView item={item} />
          </div>
        ) : (
          <div role="tabpanel" id={`${panelId}-panel-summary`} aria-labelledby={`${panelId}-tab-summary`} className="flex flex-col gap-5">
            {item.terms.length > 0 && !archived && (
              <p className="-mt-2 text-[13px] text-fg-3">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="rounded-xl bg-elevated p-4 text-[15px] leading-relaxed text-fg-2">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은 아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {/* ① 핵심 한 줄 결론 카드 (Warm Amber Card — Perplexity / Liner 스타일) */}
                {highlightSummary && (
                  <section
                    aria-label="핵심 한 줄 결론"
                    className="summary-card-amber reading-stagger flex flex-col gap-2.5 rounded-2xl p-4 sm:p-5"
                    style={staggerStyle(1)}
                  >
                    <h3 className="flex items-center gap-2 text-[13.5px] font-bold text-amber-800 [:root[data-theme=dark]_&]:text-amber-300">
                      <Highlighter className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
                      핵심 한 줄 결론 · 형광펜 요약
                    </h3>
                    <TermText
                      text={highlightSummary}
                      terms={item.terms}
                      entities={item.entities}
                      className={`${body} font-medium`}
                      highlight
                    />
                  </section>
                )}

                {/* ② 3포인트 구조화 브리핑 카드 (Clean White / Soft Blue Surface) */}
                <section
                  aria-label="3포인트 구조화 브리핑"
                  className="summary-card-brief reading-stagger flex flex-col gap-4 rounded-2xl p-4 sm:p-5"
                  style={staggerStyle(2)}
                >
                  {item.context_ko && (
                    <BriefingPoint
                      badge="원래는요 · 배경"
                      badgeClass="bg-indigo-100 text-indigo-800 [:root[data-theme=dark]_&]:bg-indigo-500/20 [:root[data-theme=dark]_&]:text-indigo-200"
                      Icon={Compass}
                    >
                      <TermText text={item.context_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                    </BriefingPoint>
                  )}

                  {item.what_ko && (
                    <BriefingPoint
                      badge="무슨 일이냐면요 · 핵심 변화"
                      badgeClass="bg-sky-100 text-sky-800 [:root[data-theme=dark]_&]:bg-sky-500/20 [:root[data-theme=dark]_&]:text-sky-200"
                      Icon={Sparkles}
                    >
                      <TermText text={item.what_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                      {item.analogy_ko && (
                        <aside className="mt-1.5 flex flex-col gap-1 rounded-xl border border-amber-300/70 bg-amber-50/80 px-3.5 py-3 [:root[data-theme=dark]_&]:border-amber-500/30 [:root[data-theme=dark]_&]:bg-amber-500/10">
                          <p className="text-[13px] font-bold text-amber-800 [:root[data-theme=dark]_&]:text-amber-300">
                            솔직히 외계어 같죠? 쉽게 비유하자면요
                          </p>
                          <TermText text={item.analogy_ko} terms={item.terms} className="t-body" />
                        </aside>
                      )}
                    </BriefingPoint>
                  )}

                  {item.why_ko && (
                    <BriefingPoint
                      badge="왜 중요할까요? · 의미"
                      badgeClass="bg-teal-100 text-teal-800 [:root[data-theme=dark]_&]:bg-teal-500/20 [:root[data-theme=dark]_&]:text-teal-200"
                      Icon={TrendingUp}
                    >
                      <TermText text={item.why_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                    </BriefingPoint>
                  )}

                  {item.caveats_ko && (
                    <BriefingPoint
                      badge="참고할 점"
                      badgeClass="bg-amber-100 text-amber-800 [:root[data-theme=dark]_&]:bg-amber-500/20 [:root[data-theme=dark]_&]:text-amber-200"
                      Icon={AlertTriangle}
                    >
                      <TermText text={item.caveats_ko} terms={item.terms} className="t-body text-fg-2" />
                    </BriefingPoint>
                  )}
                </section>

                {/* ③ 실전 활용 & 벤치마킹 카드 (Soft Emerald Card) */}
                <section
                  aria-label="어디에 써먹을까요? 실전 활용 및 벤치마킹"
                  className="summary-card-emerald reading-stagger flex flex-col gap-3.5 rounded-2xl p-4 sm:p-5"
                  style={staggerStyle(3)}
                >
                  <h3 className="flex items-center gap-2 text-[14px] font-bold text-emerald-800 [:root[data-theme=dark]_&]:text-emerald-300">
                    <Lightbulb className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
                    어디에 써먹을까요? · 실전 활용 &amp; 벤치마킹
                  </h3>
                  <ul className="flex flex-col gap-3">
                    <li className="flex flex-col gap-1">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[12.5px] font-bold text-emerald-900 [:root[data-theme=dark]_&]:bg-emerald-500/25 [:root[data-theme=dark]_&]:text-emerald-200">
                        <Target className="h-3.5 w-3.5" aria-hidden />
                        추천 상황
                      </span>
                      <p className="t-body text-fg">{utility.when_needed}</p>
                    </li>
                    <li className="flex flex-col gap-1">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-[12.5px] font-bold text-teal-900 [:root[data-theme=dark]_&]:bg-teal-500/25 [:root[data-theme=dark]_&]:text-teal-200">
                        <Zap className="h-3.5 w-3.5" aria-hidden />
                        핵심 효용
                      </span>
                      <p className="t-body text-fg">{utility.work_utility}</p>
                    </li>
                    <li className="flex flex-col gap-1">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime-100 px-2.5 py-0.5 text-[12.5px] font-bold text-lime-900 [:root[data-theme=dark]_&]:bg-lime-500/25 [:root[data-theme=dark]_&]:text-lime-200">
                        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                        바로 써볼 팁
                      </span>
                      <p className="t-body text-fg">{utility.practical_tip}</p>
                    </li>
                  </ul>
                </section>
              </>
            )}

            {item.entities.length > 0 && (
              <p className="t-meta reading-stagger leading-relaxed" style={staggerStyle(4)} aria-label="등장 키워드">
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="reading-stagger flex flex-col gap-2.5" style={staggerStyle(5)}>
              {canReadEasy ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTab("easy")}
                    className={`${BTN_PRIMARY} sheen relative overflow-hidden justify-between text-left`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <BookOpenText className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12.5px] font-medium opacity-75">원문 전체를 매거진처럼 깊이 읽고 싶다면?</span>
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
              <ProjectGuide item={item} platformName={platform?.name} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
