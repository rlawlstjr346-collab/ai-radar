"use client";

import { CATEGORY_META } from "@/lib/categories";
import { freshness } from "@/lib/filter";
import { stripHighlightMarks } from "@/lib/highlight";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitTakeaway, PlatformBadge, QuietTag } from "./Badges";

/*
 * 에디토리얼 피드 (DESIGN.md §4) — 박스·테두리 없이 표면 색, 여백, 하단 구분선만으로 나눈다.
 *   LeadStory    ① 1위 하나: bg-surface 라운드 표면, 28–32px 헤드라인
 *   FeatureStory ② 2·3위: 테두리 없는 2열, 20–21px 헤드라인 + 요약 1줄
 *   StreamRow    ③ 4위~ / 필터·검색 결과: 메타 한 줄 + 18.5px 헤드라인 (+ accent 이득 한 줄)
 * 호버는 배경색만(<120ms), 선택은 왼쪽 2px accent + bg-surface.
 */

interface Props {
  item: FeedItem;
  platform?: Platform;
  platformsById: Map<string, Platform>;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  /** 엔티티(기술 태그)를 누르면: 같은 이름의 플랫폼이 있으면 프로필, 없으면 그 키워드로 검색 */
  onEntity: (name: string) => void;
}

/** 상대 시간 — 3시간 이내면 앞에 LIVE 점(--live) 하나만, 글자는 언제나 조용한 tertiary */
function Freshness({ iso, now }: { iso: string; now: number }) {
  const f = freshness(iso, now);
  if (!f.label) return null;
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
    >
      {f.fresh && (
        <>
          <span className="live-ping" aria-hidden />
          <span className="sr-only">방금 들어온 소식, </span>
        </>
      )}
      {f.label}
    </time>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

/** 카드 상단 플랫폼명과 겹치는 엔티티는 뺀다 (예: Hugging Face 카드의 #Hugging Face) */
export function visibleEntities(item: FeedItem, platform?: Platform): string[] {
  const skip = new Set([norm(item.platform_id), ...(platform ? [norm(platform.name)] : [])]);
  return [...new Set(item.entities.map((e) => e.name))].filter((n) => !skip.has(norm(n)));
}

/** 리드 기사 하단의 조용한 키워드 링크 — 누르면 그 플랫폼 프로필 또는 키워드 검색 */
function EntityLine({ item, platform, onEntity }: { item: FeedItem; platform?: Platform; onEntity: (name: string) => void }) {
  const names = visibleEntities(item, platform).slice(0, 3);
  if (names.length === 0) return null;
  return (
    <p className="t-meta relative z-10 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      <span className="mr-1">관련</span>
      {names.map((n, i) => (
        <span key={n} className="inline-flex min-w-0 items-center">
          {i > 0 && (
            <span className="px-1" aria-hidden>
              ,
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEntity(n);
            }}
            className="max-w-[14rem] truncate rounded px-0.5 text-fg-2 underline decoration-line-strong underline-offset-4 transition-colors duration-100 hover:text-fg hover:decoration-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={`'${n}' 관련 소식 보기`}
          >
            {n}
          </button>
        </span>
      ))}
    </p>
  );
}

/** 행 전체를 덮는 버튼 (플랫폼·키워드 버튼은 z-10 으로 위에 올라와 따로 클릭됨) */
function CoverButton({ item, selected, onSelect }: { item: FeedItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      className={`text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 ${CATEGORY_META[item.category].ring}`}
    >
      {item.hook_title}
    </button>
  );
}

/** 요약 한 줄: 배경 정의(context) 대신 '무슨 일이 터졌는지'(what) */
const preview = (item: FeedItem) => {
  const t = item.what_ko ?? item.context_ko;
  return t ? stripHighlightMarks(t) : t;
};

/** 메타 한 줄: 플랫폼 · 상대시간 (+ 조용한 텍스트 배지) */
function Meta({
  item,
  platform,
  now,
  onSelectPlatform,
  tags = false,
}: {
  item: FeedItem;
  platform?: Platform;
  now: number;
  onSelectPlatform: (id: string) => void;
  tags?: boolean;
}) {
  return (
    <div className="t-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="-ml-0.5 min-w-0">
        <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
      </span>
      <span aria-hidden>·</span>
      <Freshness iso={item.created_at} now={now} />
      {tags && <QuietTags item={item} />}
    </div>
  );
}

/** 해당될 때만 붙는 조용한 텍스트 배지: 완독해설 / 논문 / N곳 포착 */
function QuietTags({ item }: { item: FeedItem }) {
  return (
    <>
      {item.easy_original_ready && (
        <QuietTag title="원문 전체를 문단별로 쉽게 풀어 쓴 완독 해설이 있어요">완독해설</QuietTag>
      )}
      {item.category === "research" && <QuietTag>논문</QuietTag>}
      {item.source_count > 1 && (
        <QuietTag title={`${item.source_count}곳에서 같은 소식을 포착했어요`}>
          <span className="tnum">{item.source_count}</span>곳 포착
        </QuietTag>
      )}
    </>
  );
}

/** ① 리드 스토리 — 화면에 단 하나 */
export function LeadStory({ item, platform, selected, now, onSelect, onSelectPlatform, onEntity }: Props) {
  const text = preview(item);
  return (
    <div data-active={selected ? "true" : "false"} className="surface beam relative flex flex-col gap-3 rounded-2xl p-6 sm:p-8">
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h2 className="t-lead">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h2>
      {text && <p className="line-clamp-2 max-w-[64ch] text-[16px] leading-[1.65] text-fg-2">{text}</p>}
      <BenefitTakeaway tag={item.benefit_tag} className="text-[15px]" />
      <div className="pt-1">
        <EntityLine item={item} platform={platform} onEntity={onEntity} />
      </div>
    </div>
  );
}

/** ② 피처 — 2·3위, 테두리 없는 2열 */
export function FeatureStory({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  const text = preview(item);
  return (
    <div data-active={selected ? "true" : "false"} className="row-hover beam relative flex h-full flex-col gap-2 rounded-lg px-3 py-4">
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} />
      <h3 className="t-feature">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      {text && <p className="line-clamp-1 text-[14.5px] leading-relaxed text-fg-2">{text}</p>}
    </div>
  );
}

/** ③ 브리핑 스트림 한 줄 — 4위~, 그리고 필터·검색 결과 전부 */
export function StreamRow({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  return (
    <div data-active={selected ? "true" : "false"} className="row-hover beam relative flex flex-col gap-1.5 rounded-lg px-3 py-4">
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h3 className="t-stream">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      <BenefitTakeaway tag={item.benefit_tag} />
    </div>
  );
}

/** 예전 이름 호환: 일반 카드 = 스트림 한 줄 */
export default function ItemCard(props: Props) {
  return <StreamRow {...props} />;
}

/** 예전 이름 호환: TOP SPOTLIGHT = 1위는 리드, 나머지는 피처 */
export function SpotlightCard({ rank, ...props }: Props & { rank: number }) {
  return rank === 1 ? <LeadStory {...props} /> : <FeatureStory {...props} />;
}
