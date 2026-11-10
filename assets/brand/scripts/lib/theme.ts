import type { Palette } from "./palette.ts";

/** Scheme of a generated artwork. */
export type Scheme = "light" | "dark";

/** Surface and text colours used by the hero, feature cards and social images. */
export interface Theme {
  scheme: Scheme;
  /** Artboard background. */
  bg: string;
  /** Raised surface (cards, windows) on top of `bg`. */
  surface: string;
  /** Placeholder (unwoven cloth) tone. */
  placeholder: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Tertiary text and captions. */
  muted: string;
  /** Hairlines and borders. */
  line: string;
  /** Very faint texture lines (warp threads in the background). */
  faint: string;
  /** Content bars standing in for text in miniature illustrations. */
  bar: string;
}

/** Light and dark themes derived from the palette neutrals. */
export function themes(p: Palette): Record<Scheme, Theme> {
  return {
    light: {
      scheme: "light",
      bg: p.neutrals.paper,
      surface: "#FFFFFF",
      placeholder: "#ECECF2",
      ink: p.neutrals.ink,
      ink2: "#3B3B4D",
      muted: "#6C6C80",
      line: p.neutrals.lineLight,
      faint: "rgba(11,11,18,.05)",
      bar: "#DCDCE6",
    },
    dark: {
      scheme: "dark",
      bg: "#0E0E16",
      surface: "#171722",
      placeholder: "#22222F",
      ink: p.neutrals.paper,
      ink2: "#C9C9D6",
      muted: "#8D8DA2",
      line: p.neutrals.lineDark,
      faint: "rgba(255,255,255,.045)",
      bar: "#2C2C3B",
    },
  };
}
