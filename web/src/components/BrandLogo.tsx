/**
 * AI Radar 브랜드 심볼 — 순수 흑백 Apple News 스타일 스쿼클 + 접힌 신문 에디토리얼 그리드 SVG.
 * 라이트 모드: #1D1D1F 스쿼클 + #FFFFFF 신문 라인 / 다크 모드: #F5F5F7 스쿼클 + #141417 신문 라인.
 */
export default function BrandLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden focusable="false">
      {/* 매끄러운 애플 연속 곡률 스쿼클 배경 */}
      <rect x="0.5" y="0.5" width="35" height="35" rx="8.5" fill="currentColor" />

      {/* 접힌 신문 에디토리얼 그리드 (균일 스트로크 + 넉넉한 내부 여백) */}
      {/* 좌측 접힌 신문 옆면 폴드 라인 */}
      <path
        d="M10.5 13.5H8.8C8.08 13.5 7.5 14.08 7.5 14.8V25.3C7.5 26.52 8.48 27.5 9.7 27.5H12.2"
        stroke="var(--bg-surface)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 본문 지면 프레임 */}
      <rect
        x="10.5"
        y="8.5"
        width="18"
        height="19"
        rx="2"
        stroke="var(--bg-surface)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* 상단 굵은 헤드라인 바 */}
      <line
        x1="13.5"
        y1="12.2"
        x2="25.5"
        y2="12.2"
        stroke="var(--bg-surface)"
        strokeWidth="2.15"
        strokeLinecap="round"
      />
      {/* 좌측 썸네일 사각 블록 */}
      <rect x="13.5" y="14.9" width="4.8" height="4.8" rx="0.9" fill="var(--bg-surface)" />
      {/* 우측 2줄 라인 */}
      <line
        x1="20.2"
        y1="16.1"
        x2="25.5"
        y2="16.1"
        stroke="var(--bg-surface)"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <line
        x1="20.2"
        y1="19.0"
        x2="25.5"
        y2="19.0"
        stroke="var(--bg-surface)"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      {/* 하단 2줄 본문 라인 */}
      <line
        x1="13.5"
        y1="22.3"
        x2="25.5"
        y2="22.3"
        stroke="var(--bg-surface)"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <line
        x1="13.5"
        y1="24.9"
        x2="22.2"
        y2="24.9"
        stroke="var(--bg-surface)"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  );
}
