/**
 * AI Radar 브랜드 심볼 — 외부 이미지 없이 디자인 토큰으로 그리는 인라인 SVG.
 *   얇은 원형 궤도 아크(1.5px, 우상단이 열려 있음) + 안쪽 동심 신호 아크 + 45도 레이더 스윕 바늘
 *   + 우상단 열린 자리에 단 하나의 --accent 시그널 도트.
 * 선·바늘은 currentColor 라 부모 글자색(다크/종이 테마)을 그대로 따른다.
 * web/src/app/icon.svg (파비콘)와 같은 좌표를 쓴다 — 하나를 고치면 둘 다 고칠 것.
 */
export default function BrandLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden focusable="false">
      {/* 바깥 궤도 아크: 우상단(-20°~-70°)만 비워 시그널 도트 자리를 남긴다 */}
      <path d="M20.46 8.92 A9 9 0 1 1 15.08 3.54" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* 안쪽 동심 신호 아크 */}
      <path d="M16.92 11.13 A5 5 0 1 1 7.30 10.29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      {/* 45도 스윕 바늘 + 중심점 */}
      <path d="M12 12 L16.24 7.76" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      {/* 시그널 도트 (유일한 유채색) */}
      <circle cx="18.36" cy="5.64" r="1.9" fill="var(--accent)" />
    </svg>
  );
}
