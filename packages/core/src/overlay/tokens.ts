import type { ResolvedTheme } from "../internal";
import { BRAND, inkOn } from "../theme";

/** Concrete colours the stage paints with, derived once from the resolved theme. */
export interface Tokens {
  /** Selection outlines, size badges, rubber bands, anchors. */
  select: string;
  /** Guides, rulers marks, measurements. */
  accent: string;
  /** Text on `select` / `accent` fills. */
  selectInk: string;
  accentInk: string;
  /** Opaque colour under Blueprint.background (covers the live page even when the background is transparent). */
  base: string;
  /** Placeholder ("ghost") fill, its outline, and glyph/label colour; tuned to the content scheme. */
  ghost: string;
  ghostLine: string;
  ghostInk: string;
  /** Rulers and status bubbles, tuned to the chrome. */
  chromeBg: string;
  chromeFg: string;
  chromeMuted: string;
  chromeLine: string;
}

export function deriveTokens(theme: ResolvedTheme): Tokens {
  const darkContent = theme.scheme === "dark";
  const darkChrome = theme.chrome === "dark";
  return {
    select: theme.select,
    accent: theme.accent,
    selectInk: inkOn(theme.select),
    accentInk: inkOn(theme.accent),
    base: darkContent ? BRAND.ink : "#ffffff",
    ghost: darkContent ? "rgba(255,255,255,0.08)" : "rgba(11,11,18,0.055)",
    ghostLine: darkContent ? "rgba(255,255,255,0.2)" : "rgba(11,11,18,0.16)",
    ghostInk: darkContent ? "rgba(255,255,255,0.42)" : "rgba(11,11,18,0.34)",
    chromeBg: darkChrome ? "rgba(20,20,30,0.94)" : "rgba(250,250,252,0.96)",
    chromeFg: darkChrome ? BRAND.paper : BRAND.ink,
    chromeMuted: darkChrome ? "rgba(250,250,252,0.56)" : "rgba(11,11,18,0.5)",
    chromeLine: darkChrome ? BRAND.lineDark : BRAND.lineLight,
  };
}
