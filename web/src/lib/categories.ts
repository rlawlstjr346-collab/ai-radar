import {
  Building2,
  Clapperboard,
  CodeXml,
  Flame,
  FlaskConical,
  MessagesSquare,
  Palette,
  Sprout,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { Category, Difficulty } from "./types";

export const CATEGORY_ORDER: Category[] = ["llm_chat", "dev", "image_design", "video_audio", "research", "industry", "social"];

/**
 * 7개 카테고리. Tailwind 클래스는 전부 정적 문자열이어야 빌드 시 퍼지되지 않는다.
 * rgb 는 스포트라이트 글로우(인라인 style)에 쓰는 포인트 컬러.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; full: string; Icon: LucideIcon; gradient: string; text: string; rgb: string; ring: string }
> = {
  llm_chat: {
    label: "챗봇·생산성",
    full: "챗봇·생산성",
    Icon: MessagesSquare,
    gradient: "from-blue-400 to-indigo-500",
    text: "text-blue-300",
    rgb: "147,197,253",
    ring: "focus-visible:ring-blue-300/60",
  },
  dev: {
    label: "코딩·에이전트",
    full: "코딩·에이전트",
    Icon: CodeXml,
    gradient: "from-cyan-300 to-sky-500",
    text: "text-cyan-300",
    rgb: "103,232,249",
    ring: "focus-visible:ring-cyan-300/60",
  },
  image_design: {
    label: "이미지·디자인",
    full: "이미지·디자인",
    Icon: Palette,
    gradient: "from-fuchsia-400 to-pink-400",
    text: "text-fuchsia-300",
    rgb: "232,121,249",
    ring: "focus-visible:ring-fuchsia-400/60",
  },
  video_audio: {
    label: "영상·사운드",
    full: "영상·사운드",
    Icon: Clapperboard,
    gradient: "from-orange-400 to-amber-300",
    text: "text-orange-300",
    rgb: "251,146,60",
    ring: "focus-visible:ring-orange-400/60",
  },
  research: {
    label: "논문·신기술",
    full: "논문·신기술",
    Icon: FlaskConical,
    gradient: "from-violet-400 to-indigo-500",
    text: "text-violet-300",
    rgb: "167,139,250",
    ring: "focus-visible:ring-violet-400/60",
  },
  industry: {
    label: "빅테크·트렌드",
    full: "빅테크·트렌드",
    Icon: Building2,
    gradient: "from-yellow-200 to-amber-400",
    text: "text-yellow-200",
    rgb: "254,240,138",
    ring: "focus-visible:ring-yellow-200/60",
  },
  social: {
    label: "커뮤니티·화제",
    full: "커뮤니티·화제",
    Icon: Users,
    gradient: "from-rose-400 to-red-400",
    text: "text-rose-300",
    rgb: "251,113,133",
    ring: "focus-visible:ring-rose-400/60",
  },
};

/**
 * '원문 난이도 해독 배지' — difficulty 는 요약 난이도가 아니라 원문이 얼마나 어려웠는지.
 * 요약은 언제나 입문자용이라, 배지는 "어려운 걸 쉽게 풀어 왔다"는 신호로 읽힌다.
 * (이모지 대신 같은 의미의 Lucide 아이콘: 🔥 Flame / ⚡ Zap / 🌱 Sprout)
 */
export const DIFFICULTY_META: Record<
  Difficulty,
  { Icon: LucideIcon; label: string; short: string; className: string; iconClass: string }
> = {
  // 1(가벼운 트렌드)은 힘을 뺀 무채색, 2·3 은 아이콘만 포인트 색
  1: { Icon: Sprout, label: "원문: 가벼운 트렌드 → 1분 정리", short: "가벼운 트렌드 → 1분 정리", className: "text-zinc-500", iconClass: "text-zinc-500" },
  2: { Icon: Zap, label: "원문: 개발 실무 문서 → 쉽게 해독 완료", short: "개발 실무 문서 → 쉽게 해독", className: "text-zinc-300", iconClass: "text-amber-300" },
  3: { Icon: Flame, label: "원문: 박사급 논문 → 쉽게 해독 완료", short: "박사급 논문 → 쉽게 해독", className: "text-zinc-300", iconClass: "text-rose-300" },
};

export const STATUS_META = {
  // 초록은 LIVE '점'에만 — 글자와 테두리는 무채색
  active: { label: "실시간 연동 중", className: "text-zinc-200 border-white/10 bg-white/[0.03]", dot: "bg-emerald-400" },
  paused: { label: "잠시 쉬는 중", className: "text-amber-300 border-amber-400/20 bg-amber-400/[0.06]", dot: "bg-amber-400" },
  directory_only: { label: "도감 추천 사이트", className: "text-zinc-400 border-white/10 bg-white/[0.03]", dot: "bg-zinc-500" },
} as const;
