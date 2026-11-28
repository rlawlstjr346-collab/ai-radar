"use client";

import { useEffect, useRef, useState } from "react";

/** 한 번 실패한 이미지 URL — 같은 기사가 다른 칸에 다시 나와도 깨진 틀을 그리지 않는다 */
const failedUrls = new Set<string>();

export function useImageAvailable(url: string | null | undefined): [boolean, () => void] {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const markFailed = () => {
    if (!url) return;
    failedUrls.add(url);
    setFailedUrl(url);
  };
  return [Boolean(url) && failedUrl !== url && !failedUrls.has(url!), markFailed];
}

/**
 * 라운드 기사 사진. 로딩 중엔 차분한 면 색, 실패하면 onFail 로 부모가 텍스트 레이아웃으로 전환한다.
 * 하이드레이션 전에 이미 실패한 이미지는 onError 가 오지 않으므로 마운트 직후 naturalWidth 를 직접 확인한다.
 */
export default function StoryImage({
  src,
  alt,
  ratio = "16 / 10",
  radius = "0.875rem",
  priority = false,
  sizes,
  onFail,
  className = "",
}: {
  src: string;
  alt: string;
  ratio?: string;
  radius?: string;
  priority?: boolean;
  sizes?: string;
  onFail: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = ref.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth === 0) onFail();
    else setLoaded(true);
    // onFail 은 부모가 매 렌더 새로 만들 수 있어 src 기준으로만 확인한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div className={`story-photo ${className}`} style={{ aspectRatio: ratio, borderRadius: radius }} data-loaded={loaded}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 외부 언론사 원본 사진 (도메인 무제한, 최적화 서버 없음) */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth === 0) onFail();
          else setLoaded(true);
        }}
        onError={onFail}
      />
    </div>
  );
}
