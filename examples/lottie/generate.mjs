#!/usr/bin/env node
/**
 * Generates the SwarmLoom Lottie sample: an original woven-shuttle loop.
 *
 *   node examples/lottie/generate.mjs
 *
 * Writes, next to this script:
 *   shuttle-loop.json    Lottie JSON (Bodymovin 5.x schema), 480 x 300, 30 fps, 4 s loop
 *   shuttle-loop.lottie  the same animation packed as a dotLottie v1 archive
 *
 * The scene is drawn here from scratch (no After Effects export, no third-party artwork):
 * a loom frame, five warp threads, a weft thread drawn on and off with a trim path, a shuttle
 * that travels along the weft while its fill fades in and out, and a caption. Output is
 * deterministic (fixed key order, no timestamps), so re-running it produces identical files.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// fflate is a dependency of the adapter package; resolve it from there.
const require = createRequire(join(here, "../../packages/adapter-lottie/package.json"));
const { zipSync, strToU8 } = require("fflate");

const W = 480;
const H = 300;
const FR = 30;
const OP = 120;

/** Brand colours (contracts/brand.md) as Lottie 0..1 RGBA. */
const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v) => Math.round((v / 255) * 1000) / 1000;
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255), 1];
};
const INK = rgb("#0B0B12");
const INDIGO = rgb("#5B5BF7");
const CORAL = rgb("#FF6B5B");
const TEAL = rgb("#14B8A6");
const AMBER = rgb("#F5A524");

const still = (k) => ({ a: 0, k });
const EASE_OUT = { i: { x: [0.25], y: [1] }, o: { x: [0.4], y: [0] } };
const EASE_IN_OUT = { i: { x: [0.55], y: [1] }, o: { x: [0.45], y: [0] } };
/** Animated property from [frame, value] pairs; the last pair carries no easing. */
const keys = (pairs, ease = EASE_IN_OUT) => ({
  a: 1,
  k: pairs.map(([t, s], i) => (i < pairs.length - 1 ? { t, s, ...ease } : { t, s })),
});

const transform = (p = [0, 0]) => ({
  ty: "tr",
  p: still(p),
  a: still([0, 0]),
  s: still([100, 100]),
  r: still(0),
  o: still(100),
  sk: still(0),
  sa: still(0),
  nm: "Transform",
});
const fill = (c, o = still(100)) => ({ ty: "fl", c: still(c), o, r: 1, nm: "Fill" });
const stroke = (c, w, o = still(100)) => ({ ty: "st", c: still(c), o, w: still(w), lc: 2, lj: 2, ml: 4, nm: "Stroke" });
const group = (nm, it) => ({ ty: "gr", nm, it: [...it, transform()] });
/** Free path from vertices with in/out tangents relative to each vertex. */
const path = (v, i, o, c) => ({ ty: "sh", ks: still({ v, i, o, c }), nm: "Path" });

const layerTransform = (p, o = still(100)) => ({
  o,
  r: still(0),
  p: p.a ? p : still(p),
  a: still([0, 0, 0]),
  s: still([100, 100, 100]),
});
const shapeLayer = (ind, nm, ks, shapes) => ({
  ddd: 0,
  ind,
  ty: 4,
  nm,
  sr: 1,
  ks,
  ao: 0,
  shapes,
  ip: 0,
  op: OP,
  st: 0,
  bm: 0,
});

/* Paper background: a solid layer the adapter folds into the stage background. */
const paper = {
  ddd: 0,
  ind: 6,
  ty: 1,
  nm: "paper",
  sr: 1,
  ks: layerTransform([0, 0, 0]),
  ao: 0,
  sc: "#fafafc",
  sw: W,
  sh: H,
  ip: 0,
  op: OP,
  st: 0,
  bm: 0,
};

/* Loom frame: a rounded rectangle outline. */
const loom = shapeLayer(5, "loom", layerTransform([240, 140, 0]), [
  group("frame", [
    { ty: "rc", d: 1, p: still([0, 0]), s: still([400, 200]), r: still(20), nm: "Rect" },
    stroke(INK, 2, still(22)),
  ]),
]);

/* Warp: five vertical threads, one group each so every thread is drawn by its own pen. */
const WARP_X = [120, 180, 240, 300, 360];
const warp = shapeLayer(
  4,
  "warp",
  layerTransform([0, 0, 0]),
  WARP_X.map((x, n) =>
    group(`thread ${n + 1}`, [
      path(
        [
          [x, 64],
          [x, 216],
        ],
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 0],
          [0, 0],
        ],
        false,
      ),
      stroke(TEAL, 4),
    ]),
  ),
);

/* Weft: a wave over and under the warp, drawn on (trim end) and then off (trim start). */
const WEFT_X = [80, 120, 180, 240, 300, 360, 400];
const WEFT_Y = [140, 128, 152, 128, 152, 128, 140];
const weftV = WEFT_X.map((x, n) => [x, WEFT_Y[n]]);
const handle = (n, dir) => {
  if ((dir < 0 && n === 0) || (dir > 0 && n === WEFT_X.length - 1)) return [0, 0];
  const span = WEFT_X[n + dir] - WEFT_X[n];
  return [Math.round(span * 0.42), 0];
};
const weft = shapeLayer(3, "weft", layerTransform([0, 0, 0]), [
  group("thread", [
    path(
      weftV,
      WEFT_X.map((_, n) => handle(n, -1)),
      WEFT_X.map((_, n) => handle(n, 1)),
      false,
    ),
    {
      ty: "tm",
      s: keys([
        [84, [0]],
        [112, [100]],
      ]),
      e: keys(
        [
          [0, [0]],
          [60, [100]],
        ],
        EASE_OUT,
      ),
      o: still(0),
      m: 1,
      nm: "Trim Paths",
    },
    stroke(CORAL, 6),
  ]),
]);

/* Shuttle: a lens-shaped hull with a bobbin, travelling along the weft; its fill fades in and out. */
const hull = path(
  [
    [-58, 0],
    [0, -17],
    [58, 0],
    [0, 17],
  ],
  [
    [0, 0],
    [-36, 0],
    [0, 0],
    [36, 0],
  ],
  [
    [0, 0],
    [36, 0],
    [0, 0],
    [-36, 0],
  ],
  true,
);
const shuttle = shapeLayer(
  2,
  "shuttle",
  layerTransform(
    keys([
      [0, [80, 140, 0]],
      [60, [400, 140, 0]],
      [120, [80, 140, 0]],
    ]),
  ),
  [
    group("bobbin", [
      { ty: "rc", d: 1, p: still([0, 0]), s: still([44, 10]), r: still(5), nm: "Rect" },
      fill(AMBER),
    ]),
    group("hull", [
      hull,
      fill(
        INDIGO,
        keys([
          [0, [0]],
          [24, [100]],
          [96, [100]],
          [120, [0]],
        ]),
      ),
    ]),
  ],
);

/* Caption: a text layer typed by the swarm in the static weave. */
const caption = {
  ddd: 0,
  ind: 1,
  ty: 5,
  nm: "caption",
  sr: 1,
  ks: layerTransform([240, 274, 0]),
  ao: 0,
  t: {
    d: { k: [{ s: { s: 22, f: "SansRegular", t: "woven by many hands", j: 2, tr: 20, lh: 26.4, ls: 0, fc: INK.slice(0, 3) }, t: 0 }] },
    p: {},
    m: { g: 1, a: still([0, 0]) },
    a: [],
  },
  ip: 0,
  op: OP,
  st: 0,
  bm: 0,
};

const animation = {
  v: "5.12.0",
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: "SwarmLoom shuttle loop",
  ddd: 0,
  assets: [],
  fonts: { list: [{ fName: "SansRegular", fFamily: "sans-serif", fStyle: "Regular", ascent: 72 }] },
  layers: [caption, shuttle, weft, warp, loom, paper],
  markers: [],
  meta: { g: "SwarmLoom examples/lottie/generate.mjs", a: "SwarmLoom contributors", d: "Original sample, MIT" },
};

const json = `${JSON.stringify(animation)}\n`;
writeFileSync(join(here, "shuttle-loop.json"), json);

const manifest = {
  version: "1",
  generator: "SwarmLoom examples/lottie/generate.mjs",
  author: "SwarmLoom contributors",
  revision: 1,
  activeAnimationId: "shuttle-loop",
  animations: [{ id: "shuttle-loop", speed: 1, loop: true, direction: 1, playMode: "normal", autoplay: true }],
};
// Fixed mtime keeps the archive byte-identical across runs.
const mtime = new Date(Date.UTC(2026, 10, 10, 0, 0, 0));
const archive = zipSync(
  {
    "manifest.json": [strToU8(JSON.stringify(manifest)), { mtime }],
    "animations/shuttle-loop.json": [strToU8(json), { mtime }],
  },
  { level: 9 },
);
writeFileSync(join(here, "shuttle-loop.lottie"), archive);

console.log(`shuttle-loop.json ${json.length} B, shuttle-loop.lottie ${archive.length} B`);
