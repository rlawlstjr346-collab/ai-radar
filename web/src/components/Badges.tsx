import { BadgeCheck, BookOpenText, Laptop, PiggyBank, ShieldCheck, Sparkles, Timer, type LucideIcon } from "lucide-react";

/*
 * Palette Budget (DESIGN.md): 배지는 전부 무채색(bg-elevated + text-fg-2) 이거나 accent 글자.
 * 유채색 칩·플랫폼 브랜드색 테두리는 쓰지 않는다.
 */

import { CATEGORY_META, DIFFICULTY_META, STATUS_META } from "@/lib/categories";
import type { Category, CollectStatus, Difficulty, Platform } from "@/lib/types";

/** 플랫폼 이니셜 모노그램 (브랜드 로고 대신 — 상표 이미지를 쓰지 않으면서 한눈에 구분되게) */
const MONOGRAM: Record<string, string> = {
  huggingface: "HF",
  "hacker-news": "HN",
  github: "GH",
  ollama: "Ol",
  openai: "OA",
  anthropic: "An",
  "google-deepmind": "GD",
  comfyui: "Cf",
  civitai: "Cv",
  bluesky: "Bs",
  openrouter: "OR",
  "lm-studio": "LM",
  lmarena: "LA",
  "artificial-analysis": "AA",
  midjourney: "MJ",
  suno: "Su",
  runway: "Rw",
  elevenlabs: "11",
  krea: "Kr",
  "reddit-localllama": "rL",
  "reddit-stablediffusion": "rS",
  x: "X",
  perplexity: "Px",
  notebooklm: "NB",
  luma: "Lu",
  kling: "Kl",
};

export function monogram(id: string, name?: string): string {
  if (MONOGRAM[id]) return MONOGRAM[id];
  const words = (name ?? id).replace(/^r\//, "").split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? "?";
  return w[0].toUpperCase() + (w[1] ?? "");
}

export function PlatformMark({
  platform,
  fallbackId,
  size = "sm",
  round = false,
}: {
  platform?: Platform;
  fallbackId: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** 출처 스택용 동그란 모양 */
  round?: boolean;
}) {
  const dims = {
    xs: "h-4 w-4 rounded-[4px] text-[8px]",
    sm: "h-5 w-5 rounded-[5px] text-[9px]",
    md: "h-8 w-8 rounded-lg text-[11px]",
    lg: "h-11 w-11 rounded-xl text-sm",
  }[size];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center bg-elevated font-semibold tracking-tight text-fg-2 ${dims} ${round ? "!rounded-full" : ""}`}
    >
      {monogram(platform?.id ?? fallbackId, platform?.name)}
    </span>
  );
}

/** 원문 난이도 해독 배지. variant="short" 는 카드용 (화면 낭독기는 항상 전체 문구를 읽는다) */
export function DifficultyBadge({ level, variant = "full" }: { level: Difficulty; variant?: "full" | "short" }) {
  const m = DIFFICULTY_META[level];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${m.className}`} title={m.label}>
      <m.Icon className={`h-3 w-3 shrink-0 ${m.iconClass}`} strokeWidth={2.2} aria-hidden />
      {variant === "full" ? (
        m.label
      ) : (
        <>
          <span aria-hidden>{m.short}</span>
          <span className="sr-only">{m.label}</span>
        </>
      )}
    </span>
  );
}

/** benefit_tag 내용에 맞는 아이콘 (데이터엔 이모지를 넣지 않고 화면이 고른다) */
function benefitIcon(tag: string): LucideIcon {
  if (/무료|라이선스|상업|Apache|MIT/i.test(tag)) return BadgeCheck;
  if (/로컬|노트북|PC|맥|온디바이스|GPU|구동/i.test(tag)) return Laptop;
  if (/배|속도|단축|ms|빠르|시간/i.test(tag)) return Timer;
  if (/비용|절감|절약|달러|가격|공모가/i.test(tag)) return PiggyBank;
  if (/설정|끄기|제한|보안/i.test(tag)) return ShieldCheck;
  return Sparkles;
}

/** '내게 생기는 이득' — 상자 없는 accent 글자 (상세 패널용, 아이콘 포함) */
export function BenefitChip({ tag, size = "sm" }: { tag: string | null | undefined; size?: "sm" | "md" }) {
  if (!tag) return null;
  const Icon = benefitIcon(tag);
  return (
    <span
      className={`relative z-10 inline-flex max-w-full items-center gap-1.5 font-medium text-accent ${
        size === "md" ? "text-[14px]" : "text-[13px]"
      }`}
    >
      <Icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={1.8} aria-hidden />
      <span className="truncate">{tag}</span>
    </span>
  );
}

/** 피드용 이득 테이크어웨이 한 줄: "→ 작업당 비용 32% 절감" */
export function BenefitTakeaway({ tag, className = "" }: { tag: string | null | undefined; className?: string }) {
  if (!tag) return null;
  return (
    <p className={`text-[14px] font-medium leading-snug text-accent ${className}`}>
      <span aria-hidden>→ </span>
      <span className="sr-only">내게 생기는 이득: </span>
      {tag}
    </p>
  );
}

/** 메타 줄의 조용한 텍스트 배지 (완독해설 · 논문 · N곳 포착) */
export function QuietTag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-elevated px-1.5 py-px text-[11.5px] font-medium text-fg-2" title={title}>
      {children}
    </span>
  );
}

export function CategoryTag({ category }: { category: Category }) {
  const m = CATEGORY_META[category];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${m.text}`}>
      <m.Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden />
      {m.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: CollectStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-medium ${m.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

/** 플랫폼 배지 — 클릭하면 우측 패널이 플랫폼 프로필로 바뀐다 */
export function PlatformBadge({
  platform,
  fallbackId,
  onSelect,
}: {
  platform?: Platform;
  fallbackId: string;
  onSelect?: (platformId: string) => void;
}) {
  const name = platform?.name ?? fallbackId;
  const content = (
    <>
      <PlatformMark platform={platform} fallbackId={fallbackId} size="xs" />
      <span className="truncate">{name}</span>
    </>
  );
  const base = "relative z-10 inline-flex max-w-[11rem] items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-1.5 text-[12.5px] font-medium text-fg-2";
  if (!onSelect) return <span className={base}>{content}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(platform?.id ?? fallbackId);
      }}
      className={`${base} cursor-pointer transition-colors duration-100 hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      aria-label={`${name} 플랫폼 소개 보기`}
    >
      {content}
    </button>
  );
}

/** 예전 카테고리 그라데이션 띠 — 장식 금지 원칙으로 이제 아무것도 그리지 않는다 (호출부 호환) */
export function CategoryLine({ category }: { category: Category }) {
  void category;
  return null;
}

/** [원본 쉽게 읽기] 완독 해설이 준비된 기사 표시 */
export function EasyReadyMark() {
  return (
    <span
      className="relative z-10 inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-px text-[11.5px] font-medium text-fg-2"
      title="원문 전체를 문단별로 쉽게 풀어 쓴 완독 해설이 있어요"
    >
      <BookOpenText className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      완독해설
    </span>
  );
}

/**
 * Perplexity 스타일 출처 스택 — 같은 소식을 포착한 플랫폼들을 겹친 동그라미로.
 * platformIds 가 source_count 보다 적으면 남은 자리는 빈 동그라미로 채운다.
 */
export function SourceStack({
  platformIds,
  count,
  platformsById,
}: {
  platformIds: string[];
  count: number;
  platformsById: Map<string, Platform>;
}) {
  if (count <= 1) return null;
  const ids = [...new Set(platformIds)].slice(0, 3);
  const blanks = Math.max(0, Math.min(3, count) - ids.length);
  const names = ids.map((id) => platformsById.get(id)?.name ?? id).join(", ");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3" title={`${count}곳에서 포착: ${names}`}>
      <span className="flex -space-x-1.5" aria-hidden>
        {ids.map((id) => (
          <span key={id} className="rounded-full ring-2 ring-canvas">
            <PlatformMark platform={platformsById.get(id)} fallbackId={id} size="xs" round />
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} className="h-4 w-4 rounded-full bg-elevated ring-2 ring-canvas" />
        ))}
      </span>
      <span className="tnum">{count}곳</span>
      <span className="sr-only">에서 포착: {names}</span>
    </span>
  );
}
