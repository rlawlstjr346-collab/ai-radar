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
 * 7개 카테고리 — Apple Machine Learning Research 스타일의 절제된 포인트 컬러 도트 & 아이브로우 텍스트.
 * Tailwind 클래스는 전부 정적 문자열이어야 빌드 시 퍼지되지 않는다.
 */
export const CATEGORY_META: Record<
  Category,
  {
    label: string;
    full: string;
    Icon: LucideIcon;
    dot: string;
    dotClass: string;
    gradient: string;
    text: string;
    rgb: string;
    ring: string;
  }
> = {
  llm_chat: {
    label: "챗봇·생성형",
    full: "챗봇·생성형",
    Icon: MessagesSquare,
    dot: "#0071E3",
    dotClass: "bg-[#0071E3] [:root[data-theme=dark]_&]:bg-[#409CFF]",
    gradient: "from-transparent to-transparent",
    text: "text-[#0071E3] [:root[data-theme=dark]_&]:text-[#409CFF]",
    rgb: "0,113,227",
    ring: "focus-visible:ring-accent",
  },
  dev: {
    label: "코딩·에이전트",
    full: "코딩·에이전트",
    Icon: CodeXml,
    dot: "#8944AB",
    dotClass: "bg-[#8944AB] [:root[data-theme=dark]_&]:bg-[#C084FC]",
    gradient: "from-transparent to-transparent",
    text: "text-[#8944AB] [:root[data-theme=dark]_&]:text-[#C084FC]",
    rgb: "137,68,171",
    ring: "focus-visible:ring-accent",
  },
  image_design: {
    label: "이미지·디자인",
    full: "이미지·디자인",
    Icon: Palette,
    dot: "#E30052",
    dotClass: "bg-[#E30052] [:root[data-theme=dark]_&]:bg-[#FF5C8D]",
    gradient: "from-transparent to-transparent",
    text: "text-[#E30052] [:root[data-theme=dark]_&]:text-[#FF5C8D]",
    rgb: "227,0,82",
    ring: "focus-visible:ring-accent",
  },
  video_audio: {
    label: "영상·사운드",
    full: "영상·사운드",
    Icon: Clapperboard,
    dot: "#F56300",
    dotClass: "bg-[#F56300] [:root[data-theme=dark]_&]:bg-[#FF8A3D]",
    gradient: "from-transparent to-transparent",
    text: "text-[#F56300] [:root[data-theme=dark]_&]:text-[#FF8A3D]",
    rgb: "245,99,0",
    ring: "focus-visible:ring-accent",
  },
  research: {
    label: "논문·신기술",
    full: "논문·신기술",
    Icon: FlaskConical,
    dot: "#008009",
    dotClass: "bg-[#008009] [:root[data-theme=dark]_&]:bg-[#30D158]",
    gradient: "from-transparent to-transparent",
    text: "text-[#008009] [:root[data-theme=dark]_&]:text-[#30D158]",
    rgb: "0,128,9",
    ring: "focus-visible:ring-accent",
  },
  industry: {
    label: "빅테크·트렌드",
    full: "빅테크·트렌드",
    Icon: Building2,
    dot: "#5856D6",
    dotClass: "bg-[#5856D6] [:root[data-theme=dark]_&]:bg-[#8E8CFF]",
    gradient: "from-transparent to-transparent",
    text: "text-[#5856D6] [:root[data-theme=dark]_&]:text-[#8E8CFF]",
    rgb: "88,86,214",
    ring: "focus-visible:ring-accent",
  },
  social: {
    label: "커뮤니티·화제",
    full: "커뮤니티·화제",
    Icon: Users,
    dot: "#007AFF",
    dotClass: "bg-[#007AFF] [:root[data-theme=dark]_&]:bg-[#5AC8FA]",
    gradient: "from-transparent to-transparent",
    text: "text-[#007AFF] [:root[data-theme=dark]_&]:text-[#5AC8FA]",
    rgb: "0,122,255",
    ring: "focus-visible:ring-accent",
  },
};

/**
 * '원문 난이도 해독 배지' — difficulty 는 요약 난이도가 아니라 원문이 얼마나 어려웠는지.
 */
export const DIFFICULTY_META: Record<
  Difficulty,
  { Icon: LucideIcon; label: string; short: string; className: string; iconClass: string }
> = {
  1: { Icon: Sprout, label: "원문: 가벼운 트렌드 → 1분 정리", short: "가벼운 트렌드 → 1분 정리", className: "text-fg-3", iconClass: "text-fg-3" },
  2: { Icon: Zap, label: "원문: 개발 실무 문서 → 쉽게 해독 완료", short: "개발 실무 문서 → 쉽게 해독", className: "text-fg-2", iconClass: "text-fg-2" },
  3: { Icon: Flame, label: "원문: 박사급 논문 → 쉽게 해독 완료", short: "박사급 논문 → 쉽게 해독", className: "text-fg-2", iconClass: "text-fg-2" },
};

export const STATUS_META = {
  active: { label: "실시간 연동 중", className: "text-fg-2 bg-elevated", dot: "bg-live" },
  paused: { label: "잠시 쉬는 중", className: "text-fg-2 bg-elevated", dot: "bg-fg-2" },
  directory_only: { label: "도감 추천 사이트", className: "text-fg-3 bg-elevated", dot: "bg-fg-3" },
} as const;
