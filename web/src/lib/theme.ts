/** 듀얼 리딩 테마 (DESIGN.md §2) + 유동 글자 크기 스케일. 값은 globals.css 와 같아야 한다. */
export type Theme = "dark" | "paper";
export type FontSizeScale = "standard" | "large";

// v2: 기본값이 다크 → 종이로 바뀌어서, 예전 키에 남은 '다크' 선택을 무시하고 모두 종이로 새로 시작한다
export const THEME_STORAGE_KEY = "ai-radar-theme-v2";
export const FONT_SIZE_STORAGE_KEY = "ai-radar-font-scale-v1";

export const THEME_TOKENS = {
  dark: {
    "--bg-base": "#0F0F10",
    "--bg-surface": "#19191A",
    "--bg-elevated": "#232325",
    "--text-primary": "#F0F0F0",
    "--text-secondary": "#A1A1A6",
    "--text-tertiary": "#94949B",
    "--accent": "#20B8CD",
  },
  paper: {
    "--bg-base": "#FCFCF9",
    "--bg-surface": "#F3F3EE",
    "--bg-elevated": "#EAEAE3",
    "--text-primary": "#27251E",
    "--text-secondary": "#5C5A52",
    "--text-tertiary": "#656259",
    "--accent": "#016A71",
  },
} as const satisfies Record<Theme, Record<string, string>>;

/** 저장값이 없거나 알 수 없으면 종이(기본) */
export function parseTheme(v: string | null | undefined): Theme {
  return v === "dark" ? "dark" : "paper";
}

/** 저장값이 'large' 일 때만 크게, 그 외는 표준 */
export function parseFontSize(v: string | null | undefined): FontSizeScale {
  return v === "large" ? "large" : "standard";
}

/**
 * 첫 페인트 전에 <head> 에서 실행할 인라인 스크립트 — 저장된 테마와 글자 크기를 바로 적용해 깜빡임을 없앤다.
 * 기본 CSS 가 이미 종이/표준이라, 다크·크게를 고른 사람만 data 속성을 붙인다.
 * localStorage 가 막힌 환경(사생활 보호 창 등)에서도 조용히 기본값으로.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark";if(localStorage.getItem("${FONT_SIZE_STORAGE_KEY}")==="large")document.documentElement.dataset.fontSize="large"}catch(e){}`;

/** WCAG 상대 휘도 */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 대비율 (1~21) */
export function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
