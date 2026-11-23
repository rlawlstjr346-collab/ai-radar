"use client";

import { ArrowRight, ArrowUpRight, BookOpenText, Languages, Radio, Zap } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { formatDate } from "@/lib/filter";
import { getHighlightSummary, getUtilityInsight } from "@/lib/reading-insights";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitChip, CategoryLine, CategoryTag, DifficultyBadge, PlatformBadge } from "./Badges";
import EasyOriginalView from "./EasyOriginalView";
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
  "press group inline-flex items-center justify-center gap-2 rounded-2xl bg-fg px-5 py-3.5 text-[15px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const BTN_SECONDARY =
  "press group inline-flex items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface/50 px-5 py-3 text-[14.5px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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

/** Apple Intelligence 스타일 — 단일 리퀴드 글라스 면 위의 헤어라인 구분 섹션 (컬러 박스 0%) */
function GlassSection({
  title,
  staggerIndex,
  children,
}: {
  title: string;
  staggerIndex: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="reading-stagger flex flex-col gap-2 border-t border-line pt-5"
      style={staggerStyle(staggerIndex)}
    >
      <h3 className="text-[14px] font-bold tracking-[-0.01em] text-fg">{title}</h3>
      {children}
    </section>
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
  const isX = item.platform_id === "x";

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="mx-auto flex w-full max-w-[66ch] flex-col gap-6 px-6 pb-10 pt-2 sm:px-9">
        <header className="reading-stagger flex flex-col gap-3" style={staggerStyle(0)}>
          <div className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {isX ? (
              <button
                type="button"
                onClick={() => onSelectPlatform("x")}
                className="inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1 font-semibold text-fg transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-elevated p-0.5 text-fg">
                  <XLogo className="h-3.5 w-3.5" />
                </span>
                <span>𝕏 실시간</span>
                {item.author_handle && <span className="font-medium text-fg-2">{item.author_handle}</span>}
              </button>
            ) : (
              <span className="-ml-0.5">
                <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
              </span>
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
                className="press inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/60 px-3 py-1 text-[13px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              <p className="-mt-1 text-[13px] text-fg-3">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="border-t border-line pt-5 text-[15px] leading-relaxed text-fg-2">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은 아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {/* 핵심 결론: 오직 이 핵심 문장에만 은은한 형광펜 하이라이트 */}
                {highlightSummary && (
                  <section
                    aria-label="핵심 결론"
                    className="reading-stagger flex flex-col gap-2 pt-1"
                    style={staggerStyle(1)}
                  >
                    <h3 className="text-[13.5px] font-bold tracking-[-0.01em] text-fg-2">핵심 결론</h3>
                    <TermText
                      text={highlightSummary}
                      terms={item.terms}
                      entities={item.entities}
                      className={`${body} font-medium`}
                      highlight
                    />
                  </section>
                )}

                {/* 기존 4단 요약 (단일 글라스 면 위 헤어라인 + 굵은 소제목 + 넉넉한 행간) */}
                {item.context_ko && (
                  <GlassSection title="원래는요" staggerIndex={2}>
                    <TermText text={item.context_ko} terms={item.terms} entities={item.entities} className={body} />
                  </GlassSection>
                )}

                {item.what_ko && (
                  <GlassSection title="무슨 일이냐면요" staggerIndex={3}>
                    <TermText text={item.what_ko} terms={item.terms} entities={item.entities} className={body} />
                    {item.analogy_ko && (
                      <blockquote className="mt-2 border-l-2 border-line-strong pl-4">
                        <p className="mb-1 text-[13px] font-semibold text-fg-2">쉽게 비유하자면요</p>
                        <TermText text={item.analogy_ko} terms={item.terms} className="t-body text-fg-2" />
                      </blockquote>
                    )}
                  </GlassSection>
                )}

                {item.why_ko && (
                  <GlassSection title="왜 중요할까요?" staggerIndex={4}>
                    <TermText text={item.why_ko} terms={item.terms} entities={item.entities} className={body} />
                  </GlassSection>
                )}

                {item.caveats_ko && (
                  <GlassSection title="참고할 점" staggerIndex={5}>
                    <TermText text={item.caveats_ko} terms={item.terms} className="t-body text-fg-2" />
                  </GlassSection>
                )}

                {/* 어디에 써먹을까요? · 실전 활용 팁 (컬러 박스 없이 헤어라인 정돈) */}
                <GlassSection title="어디에 써먹을까요? · 실전 활용 팁" staggerIndex={6}>
                  <dl className="flex flex-col gap-3 pt-1">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">추천 상황</dt>
                      <dd className="t-body text-fg-2">{utility.when_needed}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">핵심 효용</dt>
                      <dd className="t-body text-fg-2">{utility.work_utility}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">바로 써볼 팁</dt>
                      <dd className="t-body text-fg-2">{utility.practical_tip}</dd>
                    </div>
                  </dl>
                </GlassSection>
              </>
            )}

            {item.entities.length > 0 && (
              <p className="t-meta reading-stagger border-t border-line pt-4 leading-relaxed" style={staggerStyle(7)} aria-label="등장 키워드">
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="reading-stagger flex flex-col gap-2.5 pt-1" style={staggerStyle(8)}>
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
