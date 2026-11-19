import { BadgeCheck, Laptop, PiggyBank, ShieldCheck, Sparkles, Timer, type LucideIcon } from "lucide-react";

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
}: {
  platform?: Platform;
  fallbackId: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const color = platform?.theme_color ?? "#9CA3AF";
  const dims = {
    xs: "h-4 w-4 rounded-[4px] text-[8px]",
    sm: "h-5 w-5 rounded-[5px] text-[9px]",
    md: "h-8 w-8 rounded-lg text-[11px]",
    lg: "h-11 w-11 rounded-xl text-sm",
  }[size];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center border font-mono font-semibold tracking-tight ${dims}`}
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}14` }}
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
      <m.Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />
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

/** '내게 생기는 이득' 칩 — 스크롤 중 시선이 멈추게 */
export function BenefitChip({ tag, size = "sm" }: { tag: string | null | undefined; size?: "sm" | "md" }) {
  if (!tag) return null;
  const Icon = benefitIcon(tag);
  return (
    <span
      className={`relative z-10 inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-300/25 bg-emerald-300/[0.08] font-semibold text-emerald-200 ${
        size === "md" ? "px-2.5 py-1 text-[12.5px]" : "px-2 py-0.5 text-[11.5px]"
      }`}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={2.2} aria-hidden />
      <span className="truncate">{tag}</span>
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
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${m.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${status === "active" ? "animate-pulse" : ""}`} aria-hidden />
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
  const base = "relative z-10 inline-flex max-w-[11rem] items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-1.5 text-[12px] font-medium text-gray-200";
  if (!onSelect) return <span className={base}>{content}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(platform?.id ?? fallbackId);
      }}
      className={`${base} cursor-pointer transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}
      aria-label={`${name} 플랫폼 소개 보기`}
    >
      {content}
    </button>
  );
}

export function CategoryLine({ category }: { category: Category }) {
  return <div className={`h-px w-full bg-gradient-to-r ${CATEGORY_META[category].gradient} opacity-80`} aria-hidden />;
}
