"use client";

import { CATEGORY_META } from "@/lib/categories";
import { ageHours, formatDate, freshness } from "@/lib/filter";
import { stripHighlightMarks } from "@/lib/highlight";
import { editionMark } from "@/lib/regions";
import { sourceVisualFor } from "@/lib/source-style";
import type { FeedItem, Platform } from "@/lib/types";

import { BenefitTakeaway, PlatformBadge, QuietTag } from "./Badges";

interface Props {
  item: FeedItem;
  platform?: Platform;
  platformsById: Map<string, Platform>;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSelectPlatform: (id: string) => void;
  onEntity: (name: string) => void;
}

/** 상대 시간 — 3시간 이내면 슬림 마이크로 알약(+ LIVE 점), 3~24시간은 명도 보강 텍스트, 그 외는 조용한 tertiary */
function Freshness({ iso, now }: { iso: string; now: number }) {
  const f = freshness(iso, now);
  if (!f.label) return null;
  const title = new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  if (f.fresh) {
    return (
      <time
        dateTime={iso}
        title={title}
        className="time-pill-fresh inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold tabular-nums"
      >
        <span className="live-ping" aria-hidden />
        <span className="sr-only">방금 들어온 소식, </span>
        {f.label}
      </time>
    );
  }
  const within24h = ageHours(iso, now) < 24;
  return (
    <time
      dateTime={iso}
      title={title}
      className={
        within24h
          ? "time-recent inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium tabular-nums"
          : "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
      }
    >
      {f.label}
    </time>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

export function visibleEntities(item: FeedItem, platform?: Platform): string[] {
  const skip = new Set([norm(item.platform_id), ...(platform ? [norm(platform.name)] : [])]);
  return [...new Set(item.entities.map((e) => e.name))].filter((n) => !skip.has(norm(n)));
}

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

const preview = (item: FeedItem) => {
  const t = item.what_ko ?? item.context_ko;
  return t ? stripHighlightMarks(t) : t;
};

/** 메타 한 줄: 출처군 컬러 브랜드 알약 배지 + 플랫폼 + 상대시간 */
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
  const edition = editionMark(platform);
  const visual = sourceVisualFor(item.platform_id, platform);

  return (
    <div className="t-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className={`${visual.badgeClass} relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-tight`}>
        {visual.group === "x" ? "𝕏 실시간" : visual.label}
      </span>
      <span className="-ml-0.5 min-w-0">
        <PlatformBadge platform={platform} fallbackId={item.platform_id} onSelect={onSelectPlatform} />
      </span>
      {item.platform_id === "x" && item.author_handle && (
        <span className="whitespace-nowrap font-semibold text-fg">{item.author_handle}</span>
      )}
      {edition && item.platform_id !== "x" && (
        <>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">
            {edition.flag ? `${edition.flag} ` : ""}
            {edition.label}
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      {item.published_at ? (
        <Freshness iso={item.published_at} now={now} />
      ) : (
        <time
          dateTime={item.fetched_at ?? item.created_at}
          title={new Date(item.fetched_at ?? item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        >
          수집 {formatDate(item.fetched_at ?? item.created_at)}
        </time>
      )}
      {tags && <QuietTags item={item} />}
    </div>
  );
}

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

/** ① 리드 스토리 — 출처군 틴트 + 넉넉한 에디토리얼 표면 */
export function LeadStory({ item, platform, selected, now, onSelect, onSelectPlatform, onEntity }: Props) {
  const text = preview(item);
  const visual = sourceVisualFor(item.platform_id, platform);
  return (
    <div
      data-active={selected ? "true" : "false"}
      className={`${visual.cardClass} beam relative flex flex-col gap-3 rounded-2xl p-6 sm:p-7`}
    >
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h2 className="t-lead">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h2>
      {text && <p className="t-body line-clamp-2 text-fg-2">{text}</p>}
      <BenefitTakeaway tag={item.benefit_tag} className="text-[15px]" />
      <div className="pt-0.5">
        <EntityLine item={item} platform={platform} onEntity={onEntity} />
      </div>
    </div>
  );
}

/** ② 피처 — 2·3위, 출처군 컬러 틴트 2열 카드 */
export function FeatureStory({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  const text = preview(item);
  const visual = sourceVisualFor(item.platform_id, platform);
  return (
    <div
      data-active={selected ? "true" : "false"}
      className={`${visual.cardClass} beam relative flex h-full flex-col gap-2.5 rounded-xl p-4 sm:p-5`}
    >
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} />
      <h3 className="t-feature">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      {text && <p className="line-clamp-2 text-[15px] leading-[1.6] text-fg-2">{text}</p>}
    </div>
  );
}

/** ③ 브리핑 스트림 카드 — 출처군 컬러 틴트 + 브랜드 배지 + 넉넉한 여백 */
export function StreamRow({ item, platform, selected, now, onSelect, onSelectPlatform }: Props) {
  const visual = sourceVisualFor(item.platform_id, platform);
  return (
    <div
      data-active={selected ? "true" : "false"}
      className={`${visual.cardClass} beam relative flex flex-col gap-2 rounded-xl px-4 py-4 sm:px-5`}
    >
      <Meta item={item} platform={platform} now={now} onSelectPlatform={onSelectPlatform} tags />
      <h3 className="t-stream">
        <CoverButton item={item} selected={selected} onSelect={onSelect} />
      </h3>
      <BenefitTakeaway tag={item.benefit_tag} />
    </div>
  );
}

export default function ItemCard(props: Props) {
  return <StreamRow {...props} />;
}

export function SpotlightCard({ rank, ...props }: Props & { rank: number }) {
  return rank === 1 ? <LeadStory {...props} /> : <FeatureStory {...props} />;
}
