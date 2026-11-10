import type { CSSMap } from "@swarmloom/core";

/** Desk (canvas) colours behind the page sheets. Paper stays white in both themes: documents are authored for it. */
export const DESK = { light: "#E8E9EE", dark: "#17181E" } as const;

/** Vertical gap between sheets, px. */
export const PAGE_GAP = 28;

/** Desk padding around the stack of sheets, px. Narrow layouts use the compact value. */
export function deskPadding(width: number): { x: number; y: number } {
  return width < 600 ? { x: 12, y: 20 } : { x: 32, y: 36 };
}

const SHADOW = {
  light: "0 1px 2px rgba(11, 11, 18, 0.08), 0 10px 28px rgba(11, 11, 18, 0.10)",
  dark: "0 1px 2px rgba(0, 0, 0, 0.45), 0 12px 32px rgba(0, 0, 0, 0.45)",
} as const;

/** Visual style of a page sheet; also used for sheets the snapshot did not emit as layers. */
export function pageSheetStyle(theme: "light" | "dark"): CSSMap {
  return {
    "background-color": "#ffffff",
    "box-shadow": SHADOW[theme],
    "border-radius": "2px",
  };
}

/**
 * Shared CSS for the desk and its sheets, given their selectors (e.g. ".x-desk" and "section.x-page").
 * The desk stays transparent so the blueprint background shows through and only the sheets are built.
 * Selectors are combined as `desk > page`, so pass ones at least as specific as any renderer default.
 */
export function deskCss(desk: string, page: string, theme: "light" | "dark", width: number): string {
  const pad = deskPadding(width);
  return `
${desk} { display: flex; flex-direction: column; align-items: center; gap: ${PAGE_GAP}px;
  padding: ${pad.y}px ${pad.x}px; margin: 0; background: transparent; box-sizing: border-box; width: 100%; }
${desk} > ${page} { flex: none; margin: 0; background: #ffffff; box-shadow: ${SHADOW[theme]}; border-radius: 2px;
  box-sizing: border-box; color: #000000; overflow: hidden; }
`;
}

/** Width available for a sheet inside the desk, px. */
export function availableSheetWidth(width: number): number {
  return Math.max(200, width - 2 * deskPadding(width).x);
}
