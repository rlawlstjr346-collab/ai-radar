/** Apple Newsroom 무채색 듀얼 테마 + iOS 슬라이더 글자 크기 스케일(85%~200%). 값은 globals.css 와 일치한다. */
export type Theme = "dark" | "paper";
export type FontSizeScale = "standard" | "large";

export const THEME_STORAGE_KEY = "ai-radar-theme-v2";
export const FONT_SIZE_STORAGE_KEY = "ai-radar-font-scale-v1";
export const FONT_SCALE_MIN = 85;
export const FONT_SCALE_MAX = 200;
export const FONT_SCALE_DEFAULT = 100;

export const THEME_TOKENS = {
  dark: {
    "--bg-base": "#09090B",
    "--bg-surface": "#141417",
    "--bg-elevated": "#1E1E24",
    "--text-primary": "#F5F5F7",
    "--text-secondary": "#A1A1A6",
    "--text-tertiary": "#94949B",
    "--accent": "#20B8CD",
  },
  paper: {
    "--bg-base": "#F5F5F7",
    "--bg-surface": "#FFFFFF",
    "--bg-elevated": "#EBEBF0",
    "--text-primary": "#1D1D1F",
    "--text-secondary": "#515154",
    "--text-tertiary": "#636366",
    "--accent": "#016A71",
  },
} as const satisfies Record<Theme, Record<string, string>>;

/** 저장값이 없거나 알 수 없으면 라이트(Apple Newsroom 기본) */
export function parseTheme(v: string | null | undefined): Theme {
  return v === "dark" ? "dark" : "paper";
}

/** 호환용: 'large' 또는 112% 이상이면 large, 그 외 standard */
export function parseFontSize(v: string | null | undefined): FontSizeScale {
  if (v === "large") return "large";
  const num = Number(v);
  if (Number.isFinite(num) && num >= 112) return "large";
  return "standard";
}

/** 연속 슬라이더용 퍼센트(85~200) 파싱. 기존 'large'/'standard' 저장값도 자동 호환 */
export function parseFontPercent(v: string | null | undefined): number {
  if (!v) return FONT_SCALE_DEFAULT;
  if (v === "large") return 120;
  if (v === "standard") return 100;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n));
}

/**
 * 첫 페인트 전에 <head> 에서 실행할 인라인 스크립트 — 저장된 테마와 글자 크기 슬라이더(85~200%)를 바로 적용.
 * localStorage 가 막힌 환경에서도 조용히 기본값으로.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark";var fs=localStorage.getItem("${FONT_SIZE_STORAGE_KEY}");if(fs==="large"){document.documentElement.dataset.fontSize="large";document.documentElement.dataset.fontPercent="120";document.documentElement.style.setProperty("--font-scale","1.2")}else if(fs&&!isNaN(Number(fs))){var p=Math.min(${FONT_SCALE_MAX},Math.max(${FONT_SCALE_MIN},Math.round(Number(fs))));document.documentElement.dataset.fontPercent=String(p);document.documentElement.style.setProperty("--font-scale",String(p/100))}}catch(e){}`;

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
