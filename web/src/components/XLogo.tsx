/**
 * 공식 X(Twitter) 표준 벡터 로고 — viewBox="0 0 24 24" + 표준 경로.
 * 넉넉한 여백과 함께 사용해 어떤 크기에서도 절대 잘리지 않는다.
 */
export default function XLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
