import { s } from "./dom";
import {
  cursorPath,
  MARK_BG,
  MARK_CURSOR_COLOR,
  MARK_CURSOR_OUTLINE,
  MARK_PAPER,
  MARK_SIZE,
  MARK_STRAND_WIDTH,
  MARK_STRANDS,
  strandPath,
} from "./mark";

/**
 * Studio's own line icons: 24 px grid, 1.5 px strokes, round caps and joins. Each entry is a list
 * of path data strings; filled shapes are marked with a leading "F".
 */
const ICONS = {
  back: ["M14.5 6.5 9 12l5.5 5.5"],
  open: [
    "M13.5 3.75H7A2.25 2.25 0 0 0 4.75 6v12A2.25 2.25 0 0 0 7 20.25h10A2.25 2.25 0 0 0 19.25 18V9.5",
    "M13.5 3.75 19.25 9.5H15a1.5 1.5 0 0 1-1.5-1.5Z",
    "M12 17v-5.25M9.75 14 12 11.75 14.25 14",
  ],
  paste: [
    "M9 4.75H7.5A2.25 2.25 0 0 0 5.25 7v11.25A2.25 2.25 0 0 0 7.5 20.5h9a2.25 2.25 0 0 0 2.25-2.25V7A2.25 2.25 0 0 0 16.5 4.75H15",
    "M9.75 3.5h4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 9 5.75v-1.5a.75.75 0 0 1 .75-.75Z",
    "M9 11h6M9 14.5h4",
  ],
  link: [
    "M10.5 13.5a3.75 3.75 0 0 0 5.3 0l2.65-2.65a3.75 3.75 0 0 0-5.3-5.3l-1 1",
    "M13.5 10.5a3.75 3.75 0 0 0-5.3 0l-2.65 2.65a3.75 3.75 0 0 0 5.3 5.3l1-1",
  ],
  play: ["FM8 5.6v12.8c0 .8.86 1.3 1.56.9l10.4-6.4a1.05 1.05 0 0 0 0-1.8L9.56 4.7A1.04 1.04 0 0 0 8 5.6Z"],
  pause: [
    "FM7.5 5h2.25c.41 0 .75.34.75.75v12.5c0 .41-.34.75-.75.75H7.5a.75.75 0 0 1-.75-.75V5.75c0-.41.34-.75.75-.75Zm6.75 0h2.25c.41 0 .75.34.75.75v12.5c0 .41-.34.75-.75.75h-2.25a.75.75 0 0 1-.75-.75V5.75c0-.41.34-.75.75-.75Z",
  ],
  share: [
    "M12 14.25V3.75M8.25 7.5 12 3.75l3.75 3.75",
    "M8.25 10.5H7A2.25 2.25 0 0 0 4.75 12.75v5A2.25 2.25 0 0 0 7 20h10a2.25 2.25 0 0 0 2.25-2.25v-5A2.25 2.25 0 0 0 17 10.5h-1.25",
  ],
  export: [
    "M5.75 5.25h9.5A1.75 1.75 0 0 1 17 7v10a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 4 17V7a1.75 1.75 0 0 1 1.75-1.75Z",
    "m17 10.25 3.3-2.06a.5.5 0 0 1 .76.42v6.78a.5.5 0 0 1-.76.42L17 13.75",
  ],
  settings: [
    "M4.75 7.5h8.5M17.75 7.5h1.5M4.75 16.5h1.5M10.75 16.5h8.5",
    "M15.5 9.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM8.5 18.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  ],
  close: ["m6.75 6.75 10.5 10.5M17.25 6.75l-10.5 10.5"],
  sun: [
    "M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z",
    "M12 3v1.5M12 19.5V21M5.64 5.64l1.06 1.06M17.3 17.3l1.06 1.06M3 12h1.5M19.5 12H21M5.64 18.36l1.06-1.06M17.3 6.7l1.06-1.06",
  ],
  moon: ["M19.5 14.6A7.5 7.5 0 0 1 9.4 4.5a7.5 7.5 0 1 0 10.1 10.1Z"],
  system: [
    "M4.75 5.75h14.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z",
    "M9 20.25h6M12 16.25v4",
  ],
  keyboard: [
    "M4.5 6.75h15a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.75v-7.5a1.5 1.5 0 0 1 1.5-1.5Z",
    "M7 10h.01M10.33 10h.01M13.67 10h.01M17 10h.01M8.5 14h7",
  ],
  globe: [
    "M12 20.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z",
    "M3.75 12h16.5M12 3.75c2.2 2.25 3.3 5 3.3 8.25s-1.1 6-3.3 8.25c-2.2-2.25-3.3-5-3.3-8.25s1.1-6 3.3-8.25Z",
  ],
  copy: [
    "M9.25 8.25h8.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5v-8.5a1.5 1.5 0 0 1 1.5-1.5Z",
    "M15.75 8.25v-2a1.5 1.5 0 0 0-1.5-1.5h-8a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h2",
  ],
  check: ["m5.5 12.5 4 4 9-9"],
  alert: [
    "M12 8.75v4.5M12 16.25h.01",
    "M10.3 4.6 3.4 16.7A1.95 1.95 0 0 0 5.1 19.6h13.8a1.95 1.95 0 0 0 1.7-2.9L13.7 4.6a1.95 1.95 0 0 0-3.4 0Z",
  ],
  lock: [
    "M7.25 10.75h9.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z",
    "M8.75 10.75V8a3.25 3.25 0 0 1 6.5 0v2.75",
  ],
  next: ["M6.5 6.2v11.6c0 .7.76 1.13 1.36.77L16.5 13a1.2 1.2 0 0 0 0-2L7.86 5.43a.9.9 0 0 0-1.36.77Z", "M19 5.5v13"],
  phone: [
    "M8.25 3.25h7.5a1.5 1.5 0 0 1 1.5 1.5v14.5a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z",
    "M11 17.75h2",
  ],
  code: ["m8.75 8-4 4 4 4M15.25 8l4 4-4 4M13.25 5.75l-2.5 12.5"],
  book: [
    "M12 6.6c-1.6-1.2-3.75-1.85-6.25-1.85H4.5v13.5h1.25c2.5 0 4.65.65 6.25 1.85 1.6-1.2 3.75-1.85 6.25-1.85h1.25V4.75h-1.25c-2.5 0-4.65.65-6.25 1.85Z",
    "M12 6.6v13.4",
  ],
  refresh: ["M19.25 12a7.25 7.25 0 1 1-2.12-5.13", "M19.25 4.75v4h-4"],
  shuffle: [
    "M4 7.25h2.6a4 4 0 0 1 3.2 1.6l4.4 5.8a4 4 0 0 0 3.2 1.6H20",
    "M4 16.75h2.6a4 4 0 0 0 3.2-1.6l.45-.6M13.75 9.35l.45-.6a4 4 0 0 1 3.2-1.6H20",
    "m17.75 4.75 2.5 2.5-2.5 2.5M17.75 14.25l2.5 2.5-2.5 2.5",
  ],
  download: ["M12 4.75v10M8 11l4 4 4-4", "M5 16.75v1.5A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25v-1.5"],
  record: [
    "FM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z",
    "M12 20.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z",
  ],
  stop: ["FM8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"],
  terminal: [
    "M4.75 5.25h14.5a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5V6.75a1.5 1.5 0 0 1 1.5-1.5Z",
    "m7.25 9.5 2.5 2.5-2.5 2.5M12.25 14.75h4.5",
  ],
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Builds an inline SVG icon. Icons are decorative (`aria-hidden`); the surrounding control carries
 * the accessible name.
 */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = s("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "icon",
  });
  for (const d of ICONS[name]) {
    const filled = d.startsWith("F");
    svg.append(s("path", filled ? { d: d.slice(1), fill: "currentColor", stroke: "none" } : { d }));
  }
  return svg;
}

/**
 * SwarmLoom's cursor arrow for decorative use outside the stage: a rounded-tip arrow with a soft
 * light outline, filled with `color`. The stage draws the same idea on canvas.
 */
export function cursorGlyph(color: string, size = 22): SVGSVGElement {
  const svg = s("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    "aria-hidden": "true",
    focusable: "false",
    class: "cursor-glyph",
  });
  svg.append(
    s("path", {
      d: "M5.2 3.1c-.6-.43-1.45 0-1.45.75v14.9c0 .8.95 1.2 1.53.66l3.6-3.37 2.64 5.65c.22.47.77.67 1.24.46l1.8-.8c.48-.22.69-.78.47-1.26l-2.6-5.55 4.97-.32c.82-.05 1.15-1.1.5-1.6Z",
      fill: color,
      stroke: "oklch(0.99 0.005 286)",
      "stroke-width": 1.25,
      "stroke-linejoin": "round",
    }),
  );
  return svg;
}

/** The SwarmLoom mark (geometry in ./mark): three woven strands and a cursor on Loom Indigo. */
export function brandMark(size = 24): SVGSVGElement {
  const svg = s("svg", {
    viewBox: `0 0 ${MARK_SIZE} ${MARK_SIZE}`,
    width: size,
    height: size,
    "aria-hidden": "true",
    focusable: "false",
    class: "brand-mark",
  });
  svg.append(
    s("rect", {
      x: MARK_BG.x,
      y: MARK_BG.y,
      width: MARK_BG.size,
      height: MARK_BG.size,
      rx: MARK_BG.radius,
      fill: MARK_BG.color,
    }),
    s("path", {
      d: MARK_STRANDS.map(strandPath).join(""),
      fill: "none",
      stroke: MARK_PAPER,
      "stroke-width": MARK_STRAND_WIDTH,
      "stroke-linecap": "round",
    }),
    s("path", {
      d: cursorPath(),
      fill: MARK_CURSOR_COLOR,
      stroke: MARK_PAPER,
      "stroke-width": MARK_CURSOR_OUTLINE,
      "stroke-linejoin": "round",
    }),
  );
  return svg;
}
