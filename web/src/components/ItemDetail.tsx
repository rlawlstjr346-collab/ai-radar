"use client";

import { ArrowRight, ArrowUpRight, BookOpenText, Radio, Sparkles, Zap } from "lucide-react";
import { useState } from "react";

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

/**
 * 버튼 위계 (DESIGN.md §1-6): 한 화면에 solid 는 하나 — primary = text-primary 배경 + bg-base 글자,
 * secondary = 아웃라인. 두 테마 모두 토큰이 뒤집히므로 대비가 그대로 유지된다.
 */
export const BTN_PRIMARY =
  "press group inline-flex items-center justify-center gap-2 rounded-lg bg-fg px-4 py-3 text-[14.5px] font-semibold text-canvas hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const BTN_SECONDARY =
  "press group inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-[13.5px] font-medium text-fg-2 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function OriginalLink({ url, variant }: { url: string; variant: "primary" | "secondary" }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY}>
      원문 보러가기
      <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
    </a>
  );
}

/** 소제목 라벨은 13px tertiary, 번호 없이 (step 은 예전 호출부 호환용으로 받기만 한다) */
function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-step={step}>
      <h3 className="text-[13px] font-medium text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

export default function ItemDetail({ item, platform, onSelectPlatform, canReadEasy = true }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const panelId = `detail-${item.id}`;
  const body = "prose-ko t-body";
  const archived = !item.context_ko && !item.what_ko;

  return (
    <article className="flex flex-col" aria-labelledby={`detail-${item.id}`}>
      <CategoryLine category={item.category} />
      <div className="mx-auto flex w-full max-w-[64ch] flex-col gap-7 px-5 pb-10 pt-5 sm:px-7 sm:pt-6">
        <header className="flex flex-col gap-3">
          {/* 우상단 공유·닫기 버튼 자리 확보 */}
          <div className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1.5 pr-20">
            <span className="-ml-0.5">
              <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
            </span>
            <span aria-hidden>·</span>
            <CategoryTag category={item.category} />
          </div>
          <h2 id={`detail-${item.id}`} className="t-panel-title">
            {item.hook_title}
          </h2>
          <div className="flex flex-col gap-1.5">
            <BenefitChip tag={item.benefit_tag} size="md" />
            <DifficultyBadge level={item.difficulty} />
          </div>
          <p className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1">
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
              <p className="-mt-3 text-[12.5px] text-fg-3">점선 밑줄 단어에 마우스를 올리거나 누르면 쉽게 풀어드려요.</p>
            )}

            {archived ? (
              <p className="rounded-lg bg-elevated p-4 text-[15px] leading-relaxed text-fg-2">
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
                      <aside className="mt-2 flex flex-col gap-1 rounded-r-lg border-l-2 border-accent bg-elevated py-3.5 pl-4 pr-4">
                        <p className="text-[13px] font-medium text-fg-3">솔직히 외계어 같죠? 쉽게 비유하자면요</p>
                        <TermText text={item.analogy_ko} terms={item.terms} className="t-body" />
                      </aside>
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
                      className="text-[15px] leading-[1.7] text-fg-2"
                    />
                  </Section>
                )}
              </>
            )}

            {item.entities.length > 0 && (
              <p className="t-meta leading-relaxed" aria-label="등장 키워드">
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
                        <span className="text-[12px] font-medium opacity-70">영어 원문 막막하다면?</span>
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
                className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] text-fg-3"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                내 프로젝트에 이 기술 써볼까?
                <span className="rounded bg-elevated px-1.5 py-px text-[11px] text-fg-3">준비 중</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
