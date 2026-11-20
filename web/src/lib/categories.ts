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
 * Palette Budget(DESIGN.md): 카테고리에는 색을 주지 않는다 — text/ring/gradient 는 무채색·accent 토큰.
 * rgb 는 예전 호출부 호환용으로만 남긴 값이고 화면 색에는 쓰지 않는다.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; full: string; Icon: LucideIcon; gradient: string; text: string; rgb: string; ring: string }
> = {
  llm_chat: {
    label: "챗봇·생산성",
    full: "챗봇·생산성",
    Icon: MessagesSquare,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "147,197,253",
    ring: "focus-visible:ring-accent",
  },
  dev: {
    label: "코딩·에이전트",
    full: "코딩·에이전트",
    Icon: CodeXml,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "103,232,249",
    ring: "focus-visible:ring-accent",
  },
  image_design: {
    label: "이미지·디자인",
    full: "이미지·디자인",
    Icon: Palette,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "232,121,249",
    ring: "focus-visible:ring-accent",
  },
  video_audio: {
    label: "영상·사운드",
    full: "영상·사운드",
    Icon: Clapperboard,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "251,146,60",
    ring: "focus-visible:ring-accent",
  },
  research: {
    label: "논문·신기술",
    full: "논문·신기술",
    Icon: FlaskConical,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "167,139,250",
    ring: "focus-visible:ring-accent",
  },
  industry: {
    label: "빅테크·트렌드",
    full: "빅테크·트렌드",
    Icon: Building2,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "254,240,138",
    ring: "focus-visible:ring-accent",
  },
  social: {
    label: "커뮤니티·화제",
    full: "커뮤니티·화제",
    Icon: Users,
    gradient: "from-transparent to-transparent",
    text: "text-fg-2",
    rgb: "251,113,133",
    ring: "focus-visible:ring-accent",
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
  // 전부 무채색 (Palette Budget) — 난이도는 아이콘 모양과 문구로만 구분
  1: { Icon: Sprout, label: "원문: 가벼운 트렌드 → 1분 정리", short: "가벼운 트렌드 → 1분 정리", className: "text-fg-3", iconClass: "text-fg-3" },
  2: { Icon: Zap, label: "원문: 개발 실무 문서 → 쉽게 해독 완료", short: "개발 실무 문서 → 쉽게 해독", className: "text-fg-2", iconClass: "text-fg-2" },
  3: { Icon: Flame, label: "원문: 박사급 논문 → 쉽게 해독 완료", short: "박사급 논문 → 쉽게 해독", className: "text-fg-2", iconClass: "text-fg-2" },
};

export const STATUS_META = {
  // 초록(--live)은 LIVE '점'에만 — 글자·배경은 무채색
  active: { label: "실시간 연동 중", className: "text-fg-2 bg-elevated", dot: "bg-live" },
  paused: { label: "잠시 쉬는 중", className: "text-fg-2 bg-elevated", dot: "bg-fg-2" },
  directory_only: { label: "도감 추천 사이트", className: "text-fg-3 bg-elevated", dot: "bg-fg-3" },
} as const;
