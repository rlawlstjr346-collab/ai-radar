/** 듀얼 리딩 테마 (DESIGN.md §2). 값은 globals.css 의 :root / [data-theme="paper"] 와 같아야 한다. */
export type Theme = "dark" | "paper";

export const THEME_STORAGE_KEY = "ai-radar-theme";

export const THEME_TOKENS = {
  dark: {
    "--bg-base": "#0F0F10",
    "--bg-surface": "#19191A",
    "--bg-elevated": "#232325",
    "--text-primary": "#F0F0F0",
    "--text-secondary": "#A1A1A6",
    "--text-tertiary": "#6E6E73",
    "--accent": "#20B8CD",
  },
  paper: {
    "--bg-base": "#FCFCF9",
    "--bg-surface": "#F3F3EE",
    "--bg-elevated": "#EAEAE3",
    "--text-primary": "#27251E",
    "--text-secondary": "#5C5A52",
    "--text-tertiary": "#8A877D",
    "--accent": "#016A71",
  },
} as const satisfies Record<Theme, Record<string, string>>;

export function parseTheme(v: string | null | undefined): Theme {
  return v === "paper" ? "paper" : "dark";
}

/**
 * 첫 페인트 전에 <head> 에서 실행할 인라인 스크립트 — 저장된 테마를 바로 적용해 깜빡임을 없앤다.
 * localStorage 가 막힌 환경(사생활 보호 창 등)에서도 조용히 기본 다크로.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="paper")document.documentElement.dataset.theme="paper"}catch(e){}`;

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
