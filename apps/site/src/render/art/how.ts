/**
 * "How it works" diagram art: Snapshot -> Choreograph -> Build, plus Export to video.
 * Each step is a small SVG (viewBox 240x160). Animation lives in styles/how.css and plays once
 * when the diagram scrolls into view; the static markup is the finished drawing.
 */

import { cursorGlyph } from "./cursor";
import { cursorColor } from "./palette";
import type { Piece } from "./scene";
import { renderScene } from "./scene";

const W = 240;
const H = 160;

function frame(inner: string, cls: string): string {
  return `<svg class="how-art ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false" data-scene>${inner}</svg>`;
}

/** A page that peels apart into three layers. */
function snapshotArt(): string {
  const layer = (i: number, fillClass: string, content: string) =>
    `<g class="hw-layer" style="--i:${i}"><path class="${fillClass}" d="M68 92 L132 60 L196 92 L132 124 Z"/>${content}</g>`;
  return frame(
    layer(0, "hw-sheet", '<path class="hw-ink3" d="M96 92 L132 74 L168 92 L132 110 Z"/>') +
      layer(1, "hw-glass", '<path class="hw-acc-f" d="M108 84 L128 74 L148 84 L128 94 Z"/>') +
      layer(
        2,
        "hw-glass",
        '<path class="hw-ink1-s" d="M90 96 L120 81 M98 102 L140 81 M106 106 L132 93" stroke-width="3" stroke-linecap="round"/>',
      ),
    "hw-snapshot",
  );
}

/** Three timeline lanes, one per cursor, with task blocks and a sweeping playhead. */
function choreographArt(): string {
  const lanes = [
    [
      [36, 44],
      [86, 30],
      [124, 58],
    ],
    [
      [44, 62],
      [112, 40],
      [158, 34],
    ],
    [
      [36, 28],
      [70, 52],
      [128, 64],
    ],
  ];
  let out = "";
  lanes.forEach((blocks, lane) => {
    const y = 46 + lane * 30;
    out += `<line class="hw-track" x1="28" y1="${y + 8}" x2="212" y2="${y + 8}"/>`;
    out += `<g transform="translate(18 ${y + 8}) scale(.62)">${cursorGlyph(cursorColor(lane))}</g>`;
    blocks.forEach(([x, w], i) => {
      out += `<rect class="hw-block" style="--i:${lane * 3 + i};fill:${cursorColor(lane)}" x="${(x as number) + 10}" y="${y + 1}" width="${w}" height="14" rx="5"/>`;
    });
  });
  out += '<g class="hw-playhead"><line x1="40" y1="34" x2="40" y2="130"/><circle cx="40" cy="34" r="3.5"/></g>';
  return frame(out, "hw-choreo");
}

/** A small page being built by two cursors (reuses the scene engine, looping). */
function buildArt(): string {
  const pieces: Piece[] = [
    { kind: "rect", x: 54, y: 34, w: 96, h: 12, r: 6, tone: "ink1", task: { cursor: 0, slot: 0 }, reveal: "type" },
    { kind: "rect", x: 54, y: 54, w: 132, h: 6, r: 3, tone: "ink2", task: { cursor: 0, slot: 1 } },
    { kind: "rect", x: 54, y: 66, w: 110, h: 6, r: 3, tone: "ink2", task: { cursor: 0, slot: 1, lag: 0.12 } },
    { kind: "rect", x: 54, y: 86, w: 60, h: 40, r: 6, tone: "well", task: { cursor: 1, slot: 0 }, reveal: "gy" },
    { kind: "rect", x: 124, y: 86, w: 60, h: 40, r: 6, tone: "well", task: { cursor: 1, slot: 1 }, reveal: "pop" },
    { kind: "circle", cx: 84, cy: 106, r: 9, tone: "c2", task: { cursor: 1, slot: 2 } },
    { kind: "rect", x: 136, y: 100, w: 36, h: 12, r: 6, tone: "acc", task: { cursor: 0, slot: 2 }, reveal: "pop" },
  ];
  return renderScene({
    w: W,
    h: H,
    frame: [
      { kind: "rect", x: 40, y: 20, w: 160, h: 120, r: 12, tone: "sheet" },
      { kind: "rect", x: 40, y: 20, w: 160, h: 120, r: 12, tone: "line", outline: true },
    ],
    pieces,
    cursors: [
      { color: 3, enter: { x: 260, y: 30 }, park: { x: 176, y: 114 } },
      { color: 4, enter: { x: 120, y: 180 }, park: { x: 96, y: 118 } },
    ],
    cursorScale: 0.8,
    className: "how-art hw-build",
  });
}

/** A film frame with sprockets, a play mark and a waveform. */
function exportArt(): string {
  let holes = "";
  for (let i = 0; i < 8; i++) {
    holes += `<rect x="${42 + i * 20}" y="28" width="10" height="6" rx="2"/><rect x="${42 + i * 20}" y="104" width="10" height="6" rx="2"/>`;
  }
  let wave = "";
  const heights = [6, 12, 20, 14, 26, 18, 10, 22, 16, 8, 18, 12, 6];
  heights.forEach((h, i) => {
    wave += `<rect class="hw-bar" style="--i:${i}" x="${60 + i * 10}" y="${138 - h / 2}" width="5" height="${h}" rx="2.5"/>`;
  });
  return frame(
    '<rect class="hw-film" x="32" y="20" width="176" height="98" rx="10"/>' +
      `<g class="hw-holes">${holes}</g>` +
      '<rect class="hw-frame" x="44" y="40" width="152" height="58" rx="6"/>' +
      '<path class="hw-play" d="M112 56 L134 69 L112 82 Z"/>' +
      `<g class="hw-wave">${wave}</g>`,
    "hw-export",
  );
}

/** Diagram art per step, in display order. */
export function howArt(): [string, string, string, string] {
  return [snapshotArt(), choreographArt(), buildArt(), exportArt()];
}
