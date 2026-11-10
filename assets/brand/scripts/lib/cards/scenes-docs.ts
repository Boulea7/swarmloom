import { el, n } from "../svg.ts";
import {
  bars,
  box,
  caret,
  cloth,
  drift,
  hue,
  type Kit,
  label,
  pill,
  pointer,
  selectBox,
  stitch,
  windowFrame,
} from "./kit.ts";

// Scenes for page-like inputs. Stage area: x 16..464, y 16..212 (card units).

/** Web pages: a live page being rebuilt, one card still being dragged out of the cloth. */
export function webScene(k: Kit): string {
  const t = k.theme;
  const x = 64;
  const y = 22;
  const indigo = hue(k, 0);
  const sky = hue(k, 5);
  drift(k, "d1", 6, 3);
  return [
    windowFrame(k, x, y, 352, 170, { url: true }),
    box(x + 16, y + 30, 10, 10, 3, { fill: indigo }),
    bars(x + 260, y + 33, [22], t.bar),
    bars(x + 290, y + 33, [22], t.bar),
    bars(x + 320, y + 33, [16], t.bar),
    bars(x + 16, y + 52, [150, 112], t.ink, { h: 9, gap: 15 }),
    bars(x + 16, y + 86, [128], t.muted, { h: 5 }),
    box(x + 16, y + 98, 58, 16, 8, { fill: indigo }),
    box(x + 196, y + 48, 140, 66, 8, { fill: sky, "fill-opacity": 0.18 }),
    el("path", { d: `M${x + 206} ${y + 106}l26-24 18 14 30-32 42 42z`, fill: sky, "fill-opacity": 0.55 }),
    el("circle", { cx: x + 312, cy: y + 66, r: 8, fill: hue(k, 3) }),
    box(x + 16, y + 126, 100, 22, 6, { fill: t.placeholder }),
    bars(x + 24, y + 132, [60, 40], t.bar, { h: 4, gap: 7 }),
    box(x + 126, y + 126, 100, 22, 6, { fill: t.placeholder }),
    bars(x + 134, y + 132, [54, 46], t.bar, { h: 4, gap: 7 }),
    cloth(x + 236, y + 126, 100, 22, 6),
    selectBox(x + 236, y + 126, 100, 22, k.palette.select, "100 × 22"),
    caret(x + 133, y + 66, 12, hue(k, 1)),
    pointer(k, x + 134, y + 80, 1, "茜红"),
    pointer(k, x + 336, y + 148, 0, "Indigo", "d1"),
  ].join("");
}

/** File chip with a folded corner, used to show which document types flow in. */
function fileChip(k: Kit, x: number, y: number, ext: string, color: string): string {
  const t = k.theme;
  return [
    el("path", {
      d: `M${x} ${y + 4}a4 4 0 0 1 4-4h22l10 10v32a4 4 0 0 1-4 4H${x + 4}a4 4 0 0 1-4-4z`,
      fill: t.surface,
      stroke: t.line,
    }),
    el("path", { d: `M${x + 26} ${y}v10h10`, stroke: t.line, fill: "none" }),
    box(x + 4, y + 28, 28, 12, 3, { fill: color }),
    label(x + 18, y + 37, ext, "#FFFFFF", 7.5, 700, "middle"),
  ].join("");
}

/** Documents: Markdown, DOCX and DOC files flowing into a paginated page with a heading being typed. */
export function docsScene(k: Kit): string {
  const t = k.theme;
  const px = 196;
  const py = 22;
  const teal = hue(k, 2);
  drift(k, "d1", 4, -3);
  return [
    fileChip(k, 52, 44, "MD", hue(k, 0)),
    fileChip(k, 52, 100, "DOCX", hue(k, 5)),
    fileChip(k, 52, 156, "DOC", hue(k, 7)),
    el("path", {
      d: "M98 66C140 66 150 110 186 110M98 122H186M98 178C140 178 150 110 186 110",
      stroke: t.line,
      "stroke-width": 1.4,
      "stroke-dasharray": "3 3",
    }),
    box(px + 14, py + 8, 196, 178, 6, { fill: t.placeholder, stroke: t.line }),
    box(px, py, 196, 180, 6, { fill: t.surface, stroke: t.line }),
    bars(px + 22, py + 24, [108], t.ink, { h: 10 }),
    caret(px + 135, py + 21, 16, teal),
    bars(px + 22, py + 52, [150, 140, 152, 96], t.bar, { gap: 11 }),
    el("circle", { cx: px + 25, cy: py + 109, r: 2.2, fill: t.muted }),
    el("circle", { cx: px + 25, cy: py + 121, r: 2.2, fill: t.muted }),
    bars(px + 33, py + 107, [110, 84], t.bar, { gap: 12 }),
    cloth(px + 22, py + 134, 152, 32, 4),
    stitch(k, px + 22, py + 129, px + 174, py + 129),
    pointer(k, px + 140, py + 36, 2, "铜绿"),
    pointer(k, px + 174, py + 150, 3, "Weld", "d1"),
  ].join("");
}

/** PDF: pages revealed by a scan line, text above already rebuilt, cloth below still waiting. */
export function pdfScene(k: Kit): string {
  const t = k.theme;
  const px = 150;
  const py = 26;
  const w = 180;
  const h = 182;
  const scanY = py + 112;
  const sky = hue(k, 5);
  const rose = hue(k, 8);
  k.css.push(
    ".scan{animation:scan 3.6s cubic-bezier(.65,0,.35,1) infinite}",
    "@keyframes scan{0%,100%{transform:none}50%{transform:translateY(-10px)}}",
  );
  return [
    box(px + 20, py + 12, w, h - 6, 6, { fill: t.placeholder, stroke: t.line }),
    box(px + 10, py + 6, w, h - 3, 6, { fill: t.surface, stroke: t.line }),
    el("clipPath", { id: "pc" }, box(px, py, w, h, 6, {})),
    box(px, py, w, h, 6, { fill: t.surface, stroke: t.line }),
    el(
      "g",
      { "clip-path": "url(#pc)" },
      bars(px + 18, py + 20, [96], t.ink, { h: 9 }),
      bars(px + 18, py + 38, [66], t.muted, { h: 4 }),
      bars(px + 18, py + 54, [68, 64, 70, 58], t.bar, { h: 4, gap: 9 }),
      box(px + 96, py + 52, 66, 42, 4, { fill: rose, "fill-opacity": 0.16 }),
      el("path", { d: `M${px + 102} ${py + 88}l14-16 10 8 14-18 16 26z`, fill: rose, "fill-opacity": 0.6 }),
      bars(px + 18, py + 98, [144], t.bar, { h: 4 }),
      cloth(px, scanY, w, h - (scanY - py), 0),
      el(
        "g",
        { class: "scan" },
        box(px - 4, scanY - 1, w + 8, 2, 1, { fill: sky }),
        box(px, scanY - 10, w, 10, 0, { fill: sky, "fill-opacity": 0.1 }),
      ),
    ),
    pill(px + w + 30, py + 6, "3 / 12", t.scheme === "dark" ? "#3A3A4C" : "#6C6C80", 9),
    pointer(k, px + w + 4, scanY - 1, 5, "天青", "scan"),
    pointer(k, px + 120, py + 70, 8, "Cochineal"),
  ].join("");
}

/** HTML and SVG: a vector path being drawn with anchors, handles and a rubber band to the pen. */
export function vectorScene(k: Kit): string {
  const t = k.theme;
  const orchid = hue(k, 4);
  const teal = hue(k, 2);
  const pts: [number, number][] = [
    [92, 150],
    [196, 74],
    [300, 140],
  ];
  const [a, b, c] = pts as [[number, number], [number, number], [number, number]];
  const path = `M${a[0]} ${a[1]}C${a[0] + 36} ${a[1] - 60} ${b[0] - 50} ${b[1]} ${b[0]} ${b[1]}S${c[0] - 40} ${c[1] + 10} ${c[0]} ${c[1]}`;
  const grid: string[] = [];
  for (let x = 40; x <= 440; x += 20) grid.push(`M${x} 28V200`);
  for (let y = 40; y <= 200; y += 20) grid.push(`M28 ${y}H452`);
  drift(k, "d1", 6, -4);
  drift(k, "d2", 0, -8, 2.4);
  return [
    el("path", { d: grid.join(""), stroke: t.line, "stroke-width": 0.6, "stroke-opacity": 0.6 }),
    // The shapes keep their own animation running: that is what this card is about.
    el("g", { class: "d2" }, el("circle", { cx: 370, cy: 92, r: 34, fill: teal, "fill-opacity": 0.85 })),
    box(332, 136, 84, 46, 10, { fill: hue(k, 3), "fill-opacity": 0.85 }),
    el("path", { d: `${path}L300 190H92Z`, fill: orchid, "fill-opacity": 0.12 }),
    el("path", { d: path, stroke: orchid, "stroke-width": 2.4, "stroke-linecap": "round" }),
    el("path", { d: `M${b[0] - 50} ${b[1]}H${b[0] + 50}`, stroke: orchid, "stroke-width": 1 }),
    el("circle", { cx: b[0] - 50, cy: b[1], r: 3, fill: orchid }),
    el("circle", { cx: b[0] + 50, cy: b[1], r: 3, fill: orchid }),
    el(
      "g",
      { fill: t.surface, stroke: orchid, "stroke-width": 1.6 },
      ...pts.map(([x, y]) => el("circle", { cx: x, cy: y, r: 4 })),
    ),
    el("path", {
      d: `M${c[0]} ${c[1]}L${n(c[0] + 30)} ${c[1] + 34}`,
      stroke: orchid,
      "stroke-width": 1,
      "stroke-dasharray": "3 3",
    }),
    pointer(k, c[0] + 30, c[1] + 34, 4, "Tyrian"),
    pill(40, 36, "<svg>", hue(k, 0), 9),
    pointer(k, 404, 120, 2, "铜绿", "d1"),
  ].join("");
}

/** Slides and sheets: a slide with a chart bar growing, next to a sheet with a selected cell. */
export function officeScene(k: Kit): string {
  const t = k.theme;
  const sx = 36;
  const sy = 40;
  const chart = [
    [0, 34],
    [1, 52],
    [2, 40],
    [3, 68],
  ] as const;
  const sheetX = 280;
  const sheetY = 56;
  const cols = 4;
  const rows = 7;
  const cw = 40;
  const ch = 18;
  const grid: string[] = [];
  for (let i = 0; i <= cols; i++) grid.push(`M${sheetX + i * cw} ${sheetY}V${sheetY + rows * ch}`);
  for (let j = 0; j <= rows; j++) grid.push(`M${sheetX} ${sheetY + j * ch}H${sheetX + cols * cw}`);
  const cells: string[] = [];
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (j >= 5 && i >= 2) continue;
      cells.push(
        box(sheetX + i * cw + 6, sheetY + j * ch + 7, i === 0 ? 22 : 16 + ((i * 7 + j * 5) % 12), 4, 2, {
          fill: t.bar,
        }),
      );
    }
  }
  drift(k, "d1", 0, -5);
  return [
    box(sx, sy, 224, 136, 8, { fill: t.surface, stroke: t.line }),
    bars(sx + 16, sy + 18, [110], t.ink, { h: 9 }),
    bars(sx + 16, sy + 36, [70, 58], t.bar, { h: 4, gap: 9 }),
    ...chart.map(([i, h]) =>
      box(sx + 112 + i * 26, sy + 118 - h, 18, h, 3, { fill: hue(k, i), "fill-opacity": i === 3 ? 1 : 0.85 }),
    ),
    el("path", { d: `M${sx + 104} ${sy + 118}H${sx + 212}`, stroke: t.line }),
    selectBox(sx + 190, sy + 50, 18, 68, k.palette.select, "68"),
    box(sheetX, sheetY - 22, cols * cw, 16, 4, { fill: t.surface, stroke: t.line }),
    label(sheetX + 8, sheetY - 11, "=SUM(B2:B6)", t.muted, 8.5, 600),
    box(sheetX, sheetY, cols * cw, rows * ch, 4, { fill: t.surface }),
    box(sheetX, sheetY, cols * cw, ch, 0, { fill: t.placeholder }),
    el("path", { d: grid.join(""), stroke: t.line, "stroke-width": 0.8 }),
    ...cells,
    cloth(sheetX + 2 * cw + 1, sheetY + 5 * ch + 1, 2 * cw - 2, 2 * ch - 2, 0),
    box(sheetX + cw, sheetY + 6 * ch, cw, ch, 1, { stroke: k.palette.select, "stroke-width": 2, fill: "none" }),
    pointer(k, sx + 208, sy + 52, 3, "Weld", "d1"),
    pointer(k, sheetX + cw * 2 - 6, sheetY + 7 * ch - 6, 6, "Reseda"),
  ].join("");
}
