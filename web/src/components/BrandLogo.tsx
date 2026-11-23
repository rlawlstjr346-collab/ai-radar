/**
 * AI Radar 브랜드 심볼 — 유채색 없는 순수 흑백 'S자 곡선 웨이브 브로드시트 신문' 벡터 SVG.
 * - 좌측 하단의 유려한 S-커브 롤링 폴드 + 우측 상단으로 휘어지며 펼쳐진 지면
 * - 곡면을 따라 흐르는 상단 굵은 헤드라인 바, 웨이브 본문 라인, 우하단 에디토리얼 칼럼 블록
 * - currentColor + --bg-base 로 라이트(#0F0F0F) / 다크(#F7F7F7) 자동 반전
 * - web/src/app/icon.svg 파비콘과 동일한 기하 좌표를 공유한다.
 */
export default function BrandLogo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 32" fill="none" className={className} aria-hidden focusable="false">
      {/* 뒤쪽 말려 올라가는 좌측 하단 롤링 폴드 그림자 면 */}
      <path
        d="M4.2 21.8C2.7 23.4 2.7 26.2 4.6 27.6C6.4 28.9 9.1 28.6 10.7 27.1L12.6 25.3C10.2 26.1 7.6 25.4 6.5 23.8C5.8 22.8 5.2 22.2 4.2 21.8Z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      {/* 메인 S자 곡선 브로드시트 지면 (좌측 하단 롤 → 우측 상단으로 휘어지며 펼쳐짐) */}
      <path
        d="M6.2 25.4C4.2 24.1 4.1 20.6 5.8 16.4C7.5 12.1 9.6 8.4 13.4 6.1C17.4 3.7 23.2 3.3 29.9 4.5C31.2 4.7 32.1 5.9 31.8 7.2C30.4 12.7 29.1 17.6 26.9 22.5C25.3 26.1 22.4 27.9 18.2 27.7C14.1 27.5 10.8 26.2 7.8 26.2C7.1 26.2 6.6 25.8 6.2 25.4Z"
        fill="var(--bg-base)"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 좌측 하단 S-커브 롤링 립(종이가 안쪽으로 감기는 입체 굴곡) */}
      <path
        d="M6.2 25.4C8.4 26.8 11.4 25.4 12.6 22.8C13.6 20.6 12.5 18.5 10.6 18.6C8.9 18.7 7.8 20.2 8.2 21.7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 곡면을 따라 흐르는 상단 굵은 마스트헤드 / 헤드라인 바 */}
      <path
        d="M12.6 10.2C16.7 7.7 22.1 7.2 27.9 8.2"
        stroke="currentColor"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      {/* 상단 웨이브 본문 리드 라인 1 */}
      <path
        d="M11.2 14.3C15.5 12.2 20.8 11.8 26.5 12.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* 좌측 칼럼 웨이브 본문 라인 2·3 */}
      <path
        d="M14.7 17.8C16.7 17.1 18.7 16.8 20.5 16.9"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M14.4 21.1C16.2 20.6 18.0 20.4 19.6 20.5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      {/* 우하단 칼럼 피처 블록 (지면 곡률을 따라 기울어진 순수 흑백 에디토리얼 박스) */}
      <path
        d="M22.2 16.3C23.8 16.4 25.3 16.6 26.6 17.0L24.8 22.5C23.5 22.3 22.1 22.1 20.8 22.1L22.2 16.3Z"
        fill="currentColor"
      />
    </svg>
  );
}
