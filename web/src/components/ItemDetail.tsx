"use client";

import { ArrowRight, ArrowUpRight, BookOpenText, Highlighter, Languages, Lightbulb, Radio, Zap } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { formatDate } from "@/lib/filter";
import { getHighlightSummary, getUtilityInsight } from "@/lib/reading-insights";
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
  /** 이 기사의 [원본 쉽게 읽기]를 실제로 띄울 수 있는지 — 없으면 대형 유도 버튼을 숨긴다 */
  canReadEasy?: boolean;
}

export const BTN_PRIMARY =
  "press group inline-flex items-center justify-center gap-2 rounded-lg bg-fg px-4 py-3 text-[14.5px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const BTN_SECONDARY =
  "press group inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-[14px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function OriginalLink({ url, variant }: { url: string; variant: "primary" | "secondary" }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY}>
      원문 보러가기
      <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
    </a>
  );
}

const SECTION_TONE = {
  context: "text-sem-context",
  what: "text-sem-what",
  why: "text-sem-why",
  caveat: "text-sem-caveat",
} as const;

function staggerStyle(index: number): CSSProperties {
  return { "--stagger": index } as CSSProperties;
}

function Section({
  step,
  title,
  tone,
  staggerIndex = 0,
  children,
}: {
  step: string;
  title: string;
  tone?: keyof typeof SECTION_TONE;
  staggerIndex?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="reading-stagger flex flex-col gap-2" style={staggerStyle(staggerIndex)} data-step={step}>
      <h3 className={`flex items-center gap-2 text-[13.5px] font-semibold ${tone ? SECTION_TONE[tone] : "text-fg-3"}`}>
        {tone && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
        {title}
      </h3>
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

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="mx-auto flex w-full max-w-[66ch] flex-col gap-7 px-5 pb-12 pt-4 sm:px-7 sm:pt-5">
        <header className="reading-stagger flex flex-col gap-3" style={staggerStyle(0)}>
          <div className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="-ml-0.5">
              <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
            </span>
            {item.platform_id === "x" && (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-fg-2">
                  𝕏 실시간{item.author_handle ? ` · ${item.author_handle}` : ""}
                </span>
              </>
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
                className="press inline-flex items-center gap-1.5 rounded-md bg-elevated px-2.5 py-1 text-[13px] font-medium text-fg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <div role="tabpanel" id={`${panelId}-panel-summary`} aria-labelledby={`${panelId}-tab-summary`} className="flex flex-col gap-7">
            {/* 밑줄 안내는 실제로 풀이할 용어가 있을 때만 */}
            {item.terms.length > 0 && !archived && (
              <p className="-mt-3 text-[13px] text-fg-3">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="rounded-lg bg-elevated p-4 text-[15px] leading-relaxed text-fg-2">
                30일이 지난 소식이라 자세한 풀이는 보관함으로 옮겨졌어요. 원문은 아래 링크에서 볼 수 있어요.
              </p>
            ) : (
              <>
                {/* 추가 ①: 형광펜 핵심 요약 (1~2문장 + 좌→우 형광펜 스윕) */}
                {highlightSummary && (
                  <section
                    aria-label="형광펜 핵심 요약"
                    className="reading-stagger flex flex-col gap-2 rounded-xl border border-line bg-canvas/85 p-4 sm:p-5"
                    style={staggerStyle(1)}
                  >
                    <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-fg">
                      <Highlighter className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                      형광펜 핵심 요약
                    </h3>
                    <TermText text={highlightSummary} terms={item.terms} entities={item.entities} className={`${body} font-medium`} highlight />
                  </section>
                )}

                {/* 기존 4단 요약 100% 유지 */}
                {item.context_ko && (
                  <Section step="01" title="원래는요" tone="context" staggerIndex={2}>
                    <TermText text={item.context_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                  </Section>
                )}
                {item.what_ko && (
                  <Section step="02" title="무슨 일이냐면요" tone="what" staggerIndex={3}>
                    <TermText text={item.what_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                    {item.analogy_ko && (
                      <aside className="mt-2 flex flex-col gap-1 rounded-r-lg border-l-[3px] border-amber-500/70 bg-amber-500/[0.08] py-3.5 pl-4 pr-4">
                        <p className="text-[13.5px] font-semibold text-amber-700 [:root[data-theme=dark]_&]:text-amber-300">
                          솔직히 외계어 같죠? 쉽게 비유하자면요
                        </p>
                        <TermText text={item.analogy_ko} terms={item.terms} className="t-body" />
                      </aside>
                    )}
                  </Section>
                )}
                {item.why_ko && (
                  <Section step="03" title="왜 중요할까요?" tone="why" staggerIndex={4}>
                    <TermText text={item.why_ko} terms={item.terms} entities={item.entities} className={body} highlight />
                  </Section>
                )}
                {item.caveats_ko && (
                  <Section step="04" title="참고할 점" tone="caveat" staggerIndex={5}>
                    <TermText
                      text={item.caveats_ko}
                      terms={item.terms}
                      className="t-body text-fg-2"
                    />
                  </Section>
                )}

                {/* 추가 ②: 어디에 써먹을까요? · 실전 효용 & 활용 팁 */}
                <section
                  aria-label="어디에 써먹을까요? 실전 효용 및 활용 팁"
                  className="reading-stagger flex flex-col gap-3.5 rounded-xl border border-line-strong/70 bg-elevated/75 p-4 sm:p-5"
                  style={staggerStyle(6)}
                >
                  <h3 className="flex items-center gap-2 text-[14px] font-semibold text-sem-utility">
                    <Lightbulb className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    어디에 써먹을까요? · 실전 효용 &amp; 활용 팁
                  </h3>
                  <dl className="flex flex-col gap-3">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">① 어떨 때 필요한가요?</dt>
                      <dd className="t-body text-fg-2">{utility.when_needed}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">② 내 웹·앱 개발·기획·업무 효용</dt>
                      <dd className="t-body text-fg-2">{utility.work_utility}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13.5px] font-semibold text-fg">③ 바로 대입해 볼 실전 팁</dt>
                      <dd className="t-body text-fg-2">{utility.practical_tip}</dd>
                    </div>
                  </dl>
                </section>
              </>
            )}

            {item.entities.length > 0 && (
              <p className="t-meta reading-stagger leading-relaxed" style={staggerStyle(7)} aria-label="등장 키워드">
                {item.entities.map((e) => e.name).join("  ·  ")}
              </p>
            )}

            <div className="reading-stagger flex flex-col gap-2" style={staggerStyle(8)}>
              {canReadEasy ? (
                <>
                  <button type="button" onClick={() => setTab("easy")} className={`${BTN_PRIMARY} sheen relative overflow-hidden justify-between text-left`}>
                    <span className="flex min-w-0 items-center gap-3">
                      <BookOpenText className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12.5px] font-medium opacity-75">영어 원문 막막하다면?</span>
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
