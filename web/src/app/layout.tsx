import type { Metadata, Viewport } from "next";

import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI 레이더 — 입문자를 위한 글로벌 AI 소식",
  description: "전 세계 AI 연구소와 커뮤니티 소식을 레이더 요원이 쉽고 다정하게 풀어드려요.",
};

export const viewport: Viewport = {
  themeColor: "#FCFCF9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme 는 첫 페인트 전 인라인 스크립트가 바꾸므로 hydration 경고를 끈다
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
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
