/**
 * Toolbar icons: original SwarmLoom line art on a 24 x 24 grid, 1.5 px strokes, round caps and joins.
 * Each icon is a short list of SVG primitives so it can be built without innerHTML.
 */

export type IconNode = readonly [tag: "path" | "circle" | "rect", attrs: Readonly<Record<string, string | number>>];

export const ICONS = {
  play: [["path", { d: "M8.25 5.6v12.8a.6.6 0 0 0 .92.5l10.1-6.4a.6.6 0 0 0 0-1L9.17 5.1a.6.6 0 0 0-.92.5z" }]],
  pause: [
    ["rect", { x: 7, y: 5.5, width: 3, height: 13, rx: 1 }],
    ["rect", { x: 14, y: 5.5, width: 3, height: 13, rx: 1 }],
  ],
  soundOn: [
    ["path", { d: "M4.75 9.75h2.9L11.5 6.5v11l-3.85-3.25h-2.9a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1z" }],
    ["path", { d: "M15 9.6a3.4 3.4 0 0 1 0 4.8" }],
    ["path", { d: "M17.6 7.1a7 7 0 0 1 0 9.8" }],
  ],
  soundOff: [
    ["path", { d: "M4.75 9.75h2.9L11.5 6.5v11l-3.85-3.25h-2.9a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1z" }],
    ["path", { d: "M15.5 9.75l4.5 4.5M20 9.75l-4.5 4.5" }],
  ],
  tour: [
    ["circle", { cx: 12, cy: 12, r: 7.75 }],
    ["path", { d: "M15.2 8.8l-1.9 4.5-4.5 1.9 1.9-4.5z" }],
  ],
  replay: [
    ["path", { d: "M5.5 12a6.5 6.5 0 1 0 1.9-4.6" }],
    ["path", { d: "M7.4 4.2v3.2h3.2" }],
  ],
  goLive: [
    [
      "path",
      { d: "M3.75 12c1.9-3.6 4.75-5.5 8.25-5.5s6.35 1.9 8.25 5.5c-1.9 3.6-4.75 5.5-8.25 5.5S5.65 15.6 3.75 12z" },
    ],
    ["circle", { cx: 12, cy: 12, r: 2.5 }],
  ],
  record: [
    ["circle", { cx: 12, cy: 12, r: 7.25 }],
    ["circle", { cx: 12, cy: 12, r: 3.25, fill: "currentColor", stroke: "none" }],
  ],
  close: [["path", { d: "M7.25 7.25l9.5 9.5M16.75 7.25l-9.5 9.5" }]],
  check: [["path", { d: "M7.5 12.5l3 3 6-7" }]],
} as const satisfies Record<string, readonly IconNode[]>;

export type IconName = keyof typeof ICONS;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Builds a decorative (aria-hidden) icon element. */
export function createIcon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.icon = name;
  for (const [tag, attrs] of ICONS[name] as readonly IconNode[]) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}
