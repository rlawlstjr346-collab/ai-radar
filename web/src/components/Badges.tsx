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

export function DifficultyBadge({ level, compact }: { level: Difficulty; compact?: boolean }) {
  const m = DIFFICULTY_META[level];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${m.className}`}>
      <m.Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden />
      {!compact && m.label}
      {compact && <span className="sr-only">{m.label}</span>}
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
