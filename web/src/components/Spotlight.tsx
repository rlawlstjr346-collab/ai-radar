/**
 * 표면 래퍼 — 테두리·그림자·마우스 추적 글로우 없이 표면 색(.surface)만 (DESIGN.md §1-5).
 * 호버는 bg-elevated 로 100ms, 선택은 data-active 로 왼쪽 2px accent.
 * 이름은 예전 호출부 호환용으로 유지한다. rgb 는 받기만 하고 쓰지 않는다.
 */
export default function Spotlight({
  selected,
  className = "",
  children,
}: {
  rgb?: string;
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-active={selected ? "true" : "false"} className={`surface group/spot relative overflow-hidden rounded-xl ${className}`}>
      {children}
    </div>
  );
}
