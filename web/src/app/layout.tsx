import type { Metadata, Viewport } from "next";

import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Radar — 누구나 1분 만에 읽는 글로벌 AI 뉴스룸",
  description: "전 세계 AI 연구소·X 빌더·GitHub 오픈소스 소식을 1분 핵심 요약과 실전 활용 팁으로 쉽게 풀어드려요.",
};

export const viewport: Viewport = {
  themeColor: "#FCFCF9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme / data-font-size 는 첫 페인트 전 인라인 스크립트가 바꾸므로 hydration 경고를 끈다
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600;6..72,700&family=Playfair+Display:wght@700&display=swap"
        />
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh bg-canvas text-fg antialiased">{children}</body>
    </html>
  );
}
