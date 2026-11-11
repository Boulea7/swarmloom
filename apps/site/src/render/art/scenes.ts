/**
 * Scene definitions: one build placeholder per format, plus parametric web-page scenes for the
 * device line-up and the film placeholder. All geometry is original artwork.
 */

import type { FormatId } from "../../content/types";
import type {
  CirclePiece,
  LinePiece,
  PathPiece,
  Piece,
  Point,
  RectPiece,
  Reveal,
  SceneCursor,
  SceneSpec,
  Task,
  Tone,
} from "./scene";
import { renderScene } from "./scene";

/** Names shown on cursor tags in the placeholders (fictional, culture-neutral). */
export const AGENT_NAMES = [
  "Mira",
  "Kai",
  "Lin",
  "Ola",
  "Sami",
  "Noor",
  "Ren",
  "Ivo",
  "Tess",
  "Juno",
  "Ade",
  "Yuki",
] as const;

const t = (cursor: 0 | 1 | 2, slot: 0 | 1 | 2 | 3, lag?: number): Task => ({ cursor, slot, lag });

function bar(x: number, y: number, w: number, h: number, tone: Tone, task?: Task, reveal?: Reveal): RectPiece {
  return { kind: "rect", x, y, w, h, r: h / 2, tone, task, reveal };
}

function box(
  x: number,
  y: number,
  w: number,
  h: number,
  tone: Tone,
  r: number,
  task?: Task,
  reveal?: Reveal,
  opacity?: number,
): RectPiece {
  return { kind: "rect", x, y, w, h, r, tone, task, reveal, opacity };
}

function outline(x: number, y: number, w: number, h: number, tone: Tone, r: number, task?: Task): RectPiece {
  return { kind: "rect", x, y, w, h, r, tone, task, outline: true, reveal: task ? "draw" : undefined };
}

function ln(x1: number, y1: number, x2: number, y2: number, tone: Tone, task?: Task, width?: number): LinePiece {
  return { kind: "line", x1, y1, x2, y2, tone, task, width };
}

function stroke(d: string, from: Point, to: Point, tone: Tone, task?: Task, width?: number): PathPiece {
  return { kind: "path", d, from, to, tone, task, width };
}

function shape(
  d: string,
  from: Point,
  to: Point,
  tone: Tone,
  task?: Task,
  opacity?: number,
  reveal: Reveal = "fade",
): PathPiece {
  return { kind: "path", d, from, to, tone, task, fill: true, opacity, reveal };
}

function dot(cx: number, cy: number, r: number, tone: Tone, task?: Task, isOutline?: boolean): CirclePiece {
  return { kind: "circle", cx, cy, r, tone, task, outline: isOutline };
}

const SHEET: Piece[] = [box(36, 28, 328, 244, "sheet", 12), outline(36, 28, 328, 244, "line", 12)];

function crew(colors: [number, number, number], parks: [Point, Point, Point], offset: number): SceneCursor[] {
  const enters: Point[] = [
    { x: 430, y: 40 },
    { x: 430, y: 170 },
    { x: 300, y: 330 },
  ];
  return colors.map((color, i) => ({
    color,
    name: AGENT_NAMES[(offset + i) % AGENT_NAMES.length],
    enter: enters[i] as Point,
    park: parks[i] as Point,
  }));
}

type FormatScene = Pick<SceneSpec, "frame" | "pieces" | "cursors">;

const FORMAT_SCENES: Record<FormatId, () => FormatScene> = {
  web: () => ({
    frame: SHEET,
    pieces: [
      dot(58, 48, 6, "acc", t(1, 0)),
      bar(262, 45, 22, 6, "ink3", t(1, 0, 0.1)),
      bar(290, 45, 22, 6, "ink3", t(1, 0, 0.18)),
      bar(318, 45, 26, 6, "ink3", t(1, 0, 0.26)),
      ln(36, 66, 364, 66, "line", t(1, 1), 1.5),
      bar(56, 84, 196, 16, "ink1", t(0, 0), "type"),
      bar(56, 106, 132, 16, "ink1", t(0, 1), "type"),
      bar(56, 134, 170, 7, "ink2", t(0, 2)),
      box(56, 152, 72, 20, "acc", 10, t(0, 3), "pop"),
      box(252, 84, 92, 88, "well", 8, t(1, 2), "gy"),
      dot(298, 118, 16, "c2", t(1, 3)),
      box(56, 192, 88, 60, "well", 8, t(2, 0), "gy"),
      box(156, 192, 88, 60, "well", 8, t(2, 1), "pop"),
      box(256, 192, 88, 60, "well", 8, t(2, 2), "pop"),
      bar(66, 204, 50, 6, "ink2", t(2, 3)),
      bar(166, 204, 50, 6, "ink2", t(2, 3, 0.12)),
      bar(266, 204, 50, 6, "ink2", t(2, 3, 0.24)),
    ],
    cursors: crew(
      [0, 1, 2],
      [
        { x: 136, y: 168 },
        { x: 338, y: 160 },
        { x: 326, y: 240 },
      ],
      0,
    ),
  }),
  html: () => ({
    frame: SHEET,
    pieces: [
      box(58, 50, 150, 108, "acc", 18, t(0, 0), "gy"),
      box(78, 70, 60, 8, "sheet", 4, t(0, 1), "gx", 0.9),
      box(78, 86, 90, 6, "sheet", 3, t(0, 1, 0.15), "gx", 0.6),
      dot(286, 96, 40, "c1", t(1, 0)),
      outline(236, 150, 100, 26, "acc", 13, t(1, 1)),
      box(64, 190, 120, 62, "ink3", 12, t(2, 0), "fade"),
      box(58, 184, 120, 62, "well", 12, t(2, 0, 0.15), "pop"),
      shape("M318 196 L334 212 L318 228 L302 212 Z", { x: 302, y: 196 }, { x: 334, y: 228 }, "c3", t(2, 1), 1, "pop"),
      bar(200, 198, 92, 8, "ink1", t(0, 2), "type"),
      bar(200, 216, 70, 6, "ink2", t(0, 3)),
      bar(200, 232, 84, 6, "ink2", t(2, 2)),
    ],
    cursors: crew(
      [4, 5, 3],
      [
        { x: 300, y: 248 },
        { x: 346, y: 172 },
        { x: 184, y: 254 },
      ],
      3,
    ),
  }),
  svg: () => ({
    frame: SHEET,
    pieces: [
      stroke(
        "M90 92 C120 64 170 70 176 98 C182 126 132 140 104 128 C84 120 76 104 90 92 Z",
        { x: 90, y: 92 },
        { x: 92, y: 94 },
        "ink2",
        t(2, 0),
        1.5,
      ),
      shape(
        "M90 92 C120 64 170 70 176 98 C182 126 132 140 104 128 C84 120 76 104 90 92 Z",
        { x: 100, y: 90 },
        { x: 160, y: 120 },
        "c4",
        t(2, 1),
        0.85,
      ),
      stroke("M70 210 C110 130 170 120 200 160", { x: 70, y: 210 }, { x: 200, y: 160 }, "ink1", t(0, 0), 3),
      stroke("M200 160 C230 200 290 216 330 126", { x: 200, y: 160 }, { x: 330, y: 126 }, "ink1", t(0, 1), 3),
      ln(170, 120, 230, 200, "acc", t(1, 1, 0.1), 1),
      dot(170, 120, 3, "acc", t(1, 1, 0.2)),
      dot(230, 200, 3, "acc", t(1, 1, 0.25)),
      dot(70, 210, 5, "acc", t(1, 0), true),
      dot(200, 160, 5, "acc", t(1, 1), true),
      dot(330, 126, 5, "acc", t(1, 2), true),
      dot(300, 70, 10, "c3", t(2, 2)),
      stroke("M80 246 C160 230 240 258 320 240", { x: 80, y: 246 }, { x: 320, y: 240 }, "ink3", t(0, 2), 2),
    ],
    cursors: crew(
      [1, 7, 2],
      [
        { x: 334, y: 128 },
        { x: 236, y: 206 },
        { x: 306, y: 76 },
      ],
      5,
    ),
  }),
  markdown: () => ({
    frame: SHEET,
    pieces: [
      bar(56, 50, 190, 20, "ink1", t(0, 0), "type"),
      bar(56, 88, 280, 7, "ink2", t(0, 1)),
      bar(56, 102, 262, 7, "ink2", t(0, 1, 0.12)),
      bar(56, 116, 196, 7, "ink2", t(0, 1, 0.24)),
      dot(62, 146, 3, "acc", t(1, 0)),
      dot(62, 166, 3, "acc", t(1, 0, 0.1)),
      dot(62, 186, 3, "acc", t(1, 0, 0.2)),
      bar(74, 143, 150, 7, "ink2", t(1, 1)),
      bar(74, 163, 182, 7, "ink2", t(1, 2)),
      bar(74, 183, 126, 7, "ink2", t(1, 3)),
      box(56, 206, 288, 48, "well", 8, t(2, 0), "gy"),
      bar(70, 219, 52, 6, "c7", t(2, 1), "type"),
      bar(128, 219, 90, 6, "ink2", t(2, 1, 0.15), "type"),
      bar(70, 235, 110, 6, "c2", t(2, 2), "type"),
    ],
    cursors: crew(
      [0, 6, 3],
      [
        { x: 250, y: 64 },
        { x: 210, y: 192 },
        { x: 334, y: 246 },
      ],
      1,
    ),
  }),
  word: () => ({
    frame: SHEET,
    pieces: [
      bar(130, 50, 140, 14, "ink1", t(0, 0), "type"),
      bar(160, 72, 80, 6, "ink3", t(0, 1)),
      bar(56, 96, 288, 6, "ink2", t(1, 0)),
      bar(56, 108, 288, 6, "ink2", t(1, 0, 0.1)),
      bar(56, 120, 288, 6, "ink2", t(1, 0, 0.2)),
      bar(56, 132, 196, 6, "ink2", t(1, 0, 0.3)),
      box(56, 154, 288, 28, "well", 4, t(1, 1), "fade"),
      outline(56, 154, 288, 86, "line", 4, t(2, 0)),
      ln(56, 182, 344, 182, "line", t(2, 1), 1.5),
      ln(56, 211, 344, 211, "line", t(2, 1, 0.12), 1.5),
      ln(152, 154, 152, 240, "line", t(2, 2), 1.5),
      ln(248, 154, 248, 240, "line", t(2, 2, 0.12), 1.5),
      bar(66, 165, 52, 6, "ink1", t(0, 2)),
      bar(162, 165, 52, 6, "ink1", t(0, 2, 0.1)),
      bar(258, 165, 52, 6, "ink1", t(0, 2, 0.2)),
      bar(66, 194, 64, 5, "ink2", t(1, 3)),
      bar(162, 194, 40, 5, "ink2", t(1, 3, 0.1)),
      bar(258, 194, 58, 5, "ink2", t(1, 3, 0.2)),
      bar(66, 223, 44, 5, "ink2", t(0, 3)),
      bar(162, 223, 66, 5, "ink2", t(0, 3, 0.1)),
      bar(258, 223, 50, 5, "ink2", t(0, 3, 0.2)),
    ],
    cursors: crew(
      [5, 0, 11],
      [
        { x: 300, y: 70 },
        { x: 320, y: 230 },
        { x: 352, y: 196 },
      ],
      4,
    ),
  }),
  pdf: () => ({
    frame: SHEET,
    pieces: [
      bar(56, 48, 220, 16, "ink1", t(0, 0), "type"),
      bar(56, 72, 120, 6, "ink3", t(0, 1)),
      ...[0, 1, 2, 3, 4, 5].map((i) => bar(56, 94 + i * 12, i === 5 ? 98 : 136, 6, "ink2", t(1, 0, i * 0.06))),
      box(208, 92, 136, 64, "c5", 6, t(2, 0), "gy", 0.75),
      shape(
        "M208 156 L246 120 L272 140 L300 112 L344 156 Z",
        { x: 220, y: 150 },
        { x: 330, y: 150 },
        "c0",
        t(2, 1),
        0.7,
      ),
      bar(208, 164, 100, 5, "ink3", t(2, 2)),
      ...[0, 1, 2, 3].map((i) => bar(208, 180 + i * 12, i === 3 ? 90 : 136, 6, "ink2", t(1, 1, i * 0.06))),
      ...[0, 1, 2, 3, 4].map((i) => bar(56, 172 + i * 12, i === 4 ? 70 : 136, 6, "ink2", t(0, 2, i * 0.06))),
      box(56, 118, 92, 8, "c3", 2, t(2, 3), "fade", 0.45),
      bar(192, 252, 16, 5, "ink3", t(0, 3), "fade"),
    ],
    cursors: crew(
      [8, 2, 0],
      [
        { x: 214, y: 254 },
        { x: 350, y: 230 },
        { x: 152, y: 126 },
      ],
      6,
    ),
  }),
  slides: () => ({
    frame: [
      box(36, 28, 328, 244, "well", 12),
      outline(36, 28, 328, 244, "line", 12),
      box(52, 42, 296, 168, "sheet", 8),
    ],
    pieces: [
      bar(72, 68, 150, 16, "ink1", t(0, 0), "type"),
      bar(72, 92, 110, 7, "ink2", t(0, 1)),
      dot(286, 122, 44, "c3", t(1, 0)),
      box(240, 148, 32, 32, "c4", 6, t(1, 1), "pop"),
      bar(72, 124, 120, 6, "ink2", t(0, 2)),
      bar(72, 138, 96, 6, "ink2", t(0, 2, 0.1)),
      bar(72, 152, 108, 6, "ink2", t(0, 2, 0.2)),
      box(52, 224, 88, 36, "sheet", 6, t(2, 0), "pop"),
      box(156, 224, 88, 36, "sheet", 6, t(2, 1), "pop"),
      box(260, 224, 88, 36, "sheet", 6, t(2, 2), "pop"),
      bar(62, 234, 42, 5, "ink2", t(2, 3)),
      bar(166, 234, 42, 5, "ink2", t(2, 3, 0.1)),
      bar(270, 234, 42, 5, "ink2", t(2, 3, 0.2)),
      outline(52, 224, 88, 36, "acc", 6, t(1, 3)),
    ],
    cursors: crew(
      [3, 4, 9],
      [
        { x: 198, y: 160 },
        { x: 132, y: 258 },
        { x: 340, y: 256 },
      ],
      8,
    ),
  }),
  sheets: () => ({
    frame: SHEET,
    pieces: [
      box(52, 46, 296, 22, "well", 4, t(0, 0), "fade"),
      outline(52, 46, 296, 132, "line", 4, t(0, 1)),
      ...[68, 90, 112, 134, 156].map((y, i) => ln(52, y, 348, y, "line", t(1, 0, i * 0.06), 1.2)),
      ...[112, 184, 256].map((x, i) => ln(x, 46, x, 178, "line", t(1, 1, i * 0.08), 1.2)),
      ...[60, 120, 192, 264].map((x, i) => bar(x, 54, 36, 6, "ink1", t(0, 2, i * 0.08), "type")),
      ...[
        [122, 76, 40],
        [194, 76, 52],
        [266, 76, 30],
        [122, 98, 54],
        [194, 98, 34],
        [266, 98, 46],
      ].map(([x, y, w], i) =>
        bar(x as number, y as number, w as number, 6, "ink2", t(2, i < 3 ? 0 : 1, (i % 3) * 0.1)),
      ),
      box(184, 112, 72, 22, "acc", 2, t(2, 2), "fade", 0.14),
      outline(184, 112, 72, 22, "acc", 2, t(2, 2, 0.1)),
      ...[
        [70, 30],
        [96, 46],
        [122, 24],
        [148, 54],
        [174, 38],
      ].map(([x, h], i) =>
        box(x as number, 256 - (h as number), 16, h as number, i % 2 ? "c10" : "c0", 3, t(0, 3, i * 0.06), "rise"),
      ),
      stroke(
        "M212 248 L242 224 L272 234 L302 204 L332 212",
        { x: 212, y: 248 },
        { x: 332, y: 212 },
        "c1",
        t(1, 3),
        2.5,
      ),
    ],
    cursors: crew(
      [10, 0, 1],
      [
        { x: 196, y: 254 },
        { x: 340, y: 222 },
        { x: 262, y: 138 },
      ],
      2,
    ),
  }),
  code: () => ({
    frame: [
      box(36, 28, 328, 244, "ide", 12),
      dot(54, 44, 3.5, "idefg"),
      dot(66, 44, 3.5, "idefg"),
      dot(78, 44, 3.5, "idefg"),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => box(50, 62 + i * 18, 10, 5, "idefg", 2, undefined, undefined, 0.5)),
    ],
    pieces: [
      bar(72, 62, 30, 6, "c7", t(0, 0), "type"),
      bar(108, 62, 54, 6, "c5", t(0, 0, 0.15), "type"),
      bar(90, 80, 40, 6, "c3", t(0, 1), "type"),
      bar(136, 80, 70, 6, "idefg", t(0, 1, 0.15), "type"),
      bar(108, 98, 26, 6, "c7", t(0, 2), "type"),
      bar(140, 98, 90, 6, "c2", t(0, 2, 0.15), "type"),
      bar(108, 116, 60, 6, "c4", t(0, 3), "type"),
      bar(174, 116, 44, 6, "c3", t(0, 3, 0.15), "type"),
      bar(90, 134, 12, 6, "idefg", t(1, 1), "type"),
      bar(72, 152, 40, 6, "c7", t(1, 2), "type"),
      bar(118, 152, 80, 6, "c5", t(1, 2, 0.15), "type"),
      bar(90, 170, 100, 6, "c2", t(1, 3), "type"),
      box(50, 196, 300, 60, "ide2", 6, t(2, 0), "gy"),
      bar(62, 212, 8, 6, "c10", t(2, 1), "pop"),
      bar(76, 212, 120, 6, "idefg", t(2, 1, 0.12), "type"),
      bar(62, 230, 180, 6, "idefg", t(2, 2), "type"),
      dot(330, 226, 7, "c10", t(2, 3)),
    ],
    cursors: crew(
      [7, 3, 5],
      [
        { x: 226, y: 122 },
        { x: 196, y: 176 },
        { x: 318, y: 240 },
      ],
      7,
    ),
  }),
  image: () => ({
    frame: [...SHEET, box(52, 44, 296, 212, "well", 2)],
    pieces: [
      box(52, 44, 296, 212, "c5", 2, t(0, 0), "gy", 0.32),
      dot(290, 92, 22, "ink2", t(1, 0), true),
      dot(290, 92, 22, "c3", t(1, 1)),
      stroke("M52 220 L130 130 L180 180 L240 110 L348 220", { x: 52, y: 220 }, { x: 348, y: 220 }, "ink1", t(2, 0), 2),
      shape(
        "M52 256 L52 220 L130 130 L180 180 L240 110 L348 220 L348 256 Z",
        { x: 70, y: 230 },
        { x: 330, y: 240 },
        "c2",
        t(2, 1),
        0.85,
      ),
      shape("M52 256 C120 214 200 238 348 204 L348 256 Z", { x: 60, y: 240 }, { x: 340, y: 230 }, "c0", t(2, 2), 0.9),
      box(90, 70, 70, 16, "sheet", 8, t(0, 1), "gx", 0.9),
      box(128, 92, 50, 12, "sheet", 6, t(0, 2), "gx", 0.8),
      stroke("M150 128 q8 -8 16 0 q8 -8 16 0", { x: 150, y: 128 }, { x: 182, y: 128 }, "ink1", t(1, 2), 1.5),
    ],
    cursors: crew(
      [11, 9, 4],
      [
        { x: 176, y: 100 },
        { x: 320, y: 116 },
        { x: 340, y: 244 },
      ],
      9,
    ),
  }),
  model: () => {
    const top = "M200 70 L270 108 L200 146 L130 108 Z";
    const left = "M130 108 L200 146 L200 230 L130 192 Z";
    const right = "M270 108 L200 146 L200 230 L270 192 Z";
    const vertices: [number, number][] = [
      [200, 70],
      [270, 108],
      [200, 146],
      [130, 108],
      [270, 192],
      [200, 230],
      [130, 192],
    ];
    return {
      frame: SHEET,
      pieces: [
        box(130, 244, 140, 12, "ink3", 6, t(2, 0), "fade", 0.6),
        shape(top, { x: 160, y: 100 }, { x: 240, y: 116 }, "c5", t(0, 2), 0.55),
        shape(left, { x: 150, y: 150 }, { x: 190, y: 190 }, "c0", t(0, 3), 0.6),
        shape(right, { x: 250, y: 150 }, { x: 210, y: 190 }, "c9", t(2, 3), 0.45),
        stroke("M130 108 L200 70 L270 108", { x: 130, y: 108 }, { x: 270, y: 108 }, "ink1", t(0, 0), 2),
        stroke("M270 108 L200 146 L130 108", { x: 270, y: 108 }, { x: 130, y: 108 }, "ink1", t(0, 1), 2),
        ln(130, 108, 130, 192, "ink1", t(1, 0), 2),
        ln(200, 146, 200, 230, "ink1", t(1, 1), 2),
        ln(270, 108, 270, 192, "ink1", t(1, 2), 2),
        ln(130, 192, 200, 230, "ink1", t(2, 1), 2),
        ln(200, 230, 270, 192, "ink1", t(2, 2), 2),
        ...vertices.map(([x, y], i) => dot(x, y, 4, "acc", t(1, 3, i * 0.05))),
      ],
      cursors: crew(
        [9, 1, 6],
        [
          { x: 300, y: 86 },
          { x: 96, y: 210 },
          { x: 300, y: 236 },
        ],
        10,
      ),
    };
  },
};

/** Animated build placeholder for a format card (viewBox 400x300). */
export function formatScene(id: FormatId): string {
  const scene = FORMAT_SCENES[id]();
  return renderScene({
    w: 400,
    h: 300,
    ...scene,
    tags: true,
    cursorScale: 1.15,
    className: `scene-format scene-${id}`,
  });
}

/** Options for {@link webScene}. */
export interface WebSceneOptions {
  /** Palette indices of the three cursors. */
  colors?: [number, number, number];
  tags?: boolean;
  cursorScale?: number;
  className?: string;
  /** Offset into {@link AGENT_NAMES}. */
  names?: number;
  place?: SceneSpec["place"];
}

/**
 * A web page being built at any aspect ratio: nav, two-line heading, lead, button and a card grid
 * whose column count follows the width. Used for device screens and the film placeholder.
 */
export function webScene(w: number, h: number, options: WebSceneOptions = {}): string {
  const unit = Math.min(w, h * 1.6) / 100;
  const pad = Math.max(10, w * 0.07);
  const inner = w - pad * 2;
  const navY = pad * 0.8;
  const navH = unit * 2.4;
  const cols = w >= 420 ? 3 : w >= 240 ? 2 : 1;
  const headH = unit * (cols === 1 ? 6.5 : 5.2);
  const headY = navY + navH + unit * 7;
  const leadY = headY + headH * 2 + unit * 3.6;
  const btnY = leadY + unit * 4.4;
  const btnH = unit * 5;
  const gridY = btnY + btnH + unit * 7;
  const gap = unit * 2.6;
  const cardW = (inner - gap * (cols - 1)) / cols;
  const cardH = Math.max(unit * 10, Math.min(h - gridY - pad, cardW * 0.72));
  const pieces: Piece[] = [
    dot(pad + navH * 0.5, navY + navH * 0.5, navH * 0.55, "acc", t(1, 0)),
    bar(w - pad - inner * 0.34, navY + navH * 0.25, inner * 0.1, navH * 0.5, "ink3", t(1, 0, 0.1)),
    bar(w - pad - inner * 0.2, navY + navH * 0.25, inner * 0.1, navH * 0.5, "ink3", t(1, 0, 0.2)),
    ln(0, navY + navH + unit * 2.4, w, navY + navH + unit * 2.4, "line", t(1, 1), Math.max(1, unit * 0.25)),
    bar(pad, headY, inner * (cols === 1 ? 0.92 : 0.62), headH, "ink1", t(0, 0), "type"),
    bar(pad, headY + headH * 1.35, inner * (cols === 1 ? 0.6 : 0.4), headH, "ink1", t(0, 1), "type"),
    bar(pad, leadY, inner * (cols === 1 ? 0.8 : 0.5), unit * 1.8, "ink2", t(0, 2)),
    box(pad, btnY, Math.max(inner * 0.22, unit * 16), btnH, "acc", btnH / 2, t(0, 3), "pop"),
  ];
  if (cols > 1) {
    const artW = inner * 0.3;
    pieces.push(box(w - pad - artW, headY, artW, gridY - headY - unit * 6, "well", unit * 2, t(1, 2), "gy"));
    pieces.push(dot(w - pad - artW / 2, headY + (gridY - headY - unit * 6) / 2, artW * 0.18, "c2", t(1, 3)));
  }
  const rows = cols === 1 ? Math.max(1, Math.floor((h - gridY - pad) / (cardH + gap))) : 1;
  let slot = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = pad + col * (cardW + gap);
      const y = gridY + row * (cardH + gap);
      if (y + cardH > h) continue;
      const s = Math.min(slot, 3) as 0 | 1 | 2 | 3;
      pieces.push(
        box(x, y, cardW, cardH, "well", unit * 1.8, t(2, s, slot > 3 ? (slot - 3) * 0.12 : 0), slot ? "pop" : "gy"),
      );
      pieces.push(
        bar(
          x + unit * 2,
          y + unit * 2.4,
          cardW * 0.55,
          unit * 1.6,
          "ink2",
          t(2, s, 0.15 + (slot > 3 ? (slot - 3) * 0.12 : 0)),
        ),
      );
      slot++;
    }
  }
  const colors = options.colors ?? [0, 1, 2];
  const names = options.names ?? 0;
  const cursors: SceneCursor[] = colors.map((color, i) => ({
    color,
    name: AGENT_NAMES[(names + i) % AGENT_NAMES.length],
    enter: [
      { x: w + 30, y: h * 0.2 },
      { x: w + 30, y: h * 0.6 },
      { x: w * 0.7, y: h + 30 },
    ][i] as Point,
    park: [
      { x: pad + inner * 0.3, y: btnY + btnH * 0.9 },
      { x: w - pad - inner * 0.08, y: headY + unit * 4 },
      { x: pad + inner * 0.82, y: Math.min(h - pad * 0.6, gridY + cardH * 0.7) },
    ][i] as Point,
  }));
  return renderScene({
    w,
    h,
    pieces,
    cursors,
    tags: options.tags ?? false,
    cursorScale: options.cursorScale ?? Math.max(0.6, unit / 4.2),
    className: options.className,
    place: options.place,
  });
}

/** A tiny round-safe player scene for the watch screen. */
export function watchScene(w: number, h: number, place?: SceneSpec["place"]): string {
  const cx = w / 2;
  const pieces: Piece[] = [
    dot(cx, h * 0.36, w * 0.17, "acc", t(0, 0)),
    bar(w * 0.24, h * 0.62, w * 0.52, h * 0.06, "ink1", t(0, 1), "type"),
    bar(w * 0.32, h * 0.73, w * 0.36, h * 0.045, "ink2", t(1, 1)),
    outline(w * 0.18, h * 0.16, w * 0.64, h * 0.68, "line", w * 0.12, t(1, 0)),
  ];
  const cursors: SceneCursor[] = [
    { color: 3, enter: { x: w + 20, y: h * 0.3 }, park: { x: w * 0.7, y: h * 0.44 } },
    { color: 4, enter: { x: -20, y: h * 0.8 }, park: { x: w * 0.28, y: h * 0.82 } },
  ];
  return renderScene({ w, h, pieces, cursors, cursorScale: 0.75, place });
}

/** Foldable screen: stage on the left segment, playback controls on the right segment. */
export function foldableScene(w: number, h: number, place?: SceneSpec["place"]): string {
  const half = w / 2;
  const pad = half * 0.1;
  const pieces: Piece[] = [
    bar(pad, h * 0.14, half * 0.6, h * 0.06, "ink1", t(0, 0), "type"),
    bar(pad, h * 0.24, half * 0.42, h * 0.06, "ink1", t(0, 1), "type"),
    box(pad, h * 0.38, half - pad * 2, h * 0.3, "well", 8, t(1, 0), "gy"),
    dot(half / 2, h * 0.53, h * 0.07, "c1", t(1, 1)),
    bar(pad, h * 0.76, half * 0.5, h * 0.035, "ink2", t(0, 2)),
    dot(half + half / 2, h * 0.32, h * 0.1, "acc", t(2, 0)),
    bar(half + pad, h * 0.56, half - pad * 2, h * 0.03, "ink3", t(2, 1)),
    bar(half + pad, h * 0.56, (half - pad * 2) * 0.6, h * 0.03, "acc", t(2, 2)),
    bar(half + pad, h * 0.68, half * 0.5, h * 0.03, "ink3", t(2, 2, 0.1)),
    bar(half + pad, h * 0.76, half * 0.36, h * 0.03, "ink3", t(2, 3)),
  ];
  const cursors: SceneCursor[] = [
    { color: 5, enter: { x: -20, y: h * 0.2 }, park: { x: half * 0.72, y: h * 0.3 } },
    { color: 0, enter: { x: half * 0.5, y: h + 20 }, park: { x: half * 0.4, y: h * 0.7 } },
    { color: 9, enter: { x: w + 20, y: h * 0.5 }, park: { x: half + half * 0.66, y: h * 0.6 } },
  ];
  return renderScene({ w, h, pieces, cursors, cursorScale: 0.8, place });
}
