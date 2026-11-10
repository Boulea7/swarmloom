import { MARK_GRID, markBody, markStyles } from "../mark.ts";
import { el, n } from "../svg.ts";
import { bars, box, caret, cloth, drift, hue, type Kit, label, pill, pointer, selectBox, windowFrame } from "./kit.ts";

// Scenes for code, media and outputs. Stage area: x 16..464, y 16..212 (card units).

/** Code: an editor typing syntax-coloured tokens line by line. */
export function codeScene(k: Kit): string {
  const t = k.theme;
  const x = 48;
  const y = 30;
  const lines: [number, [number, number][]][] = [
    // [indent, [[colourIndex or -1 for plain, width], ...]]
    [
      0,
      [
        [0, 34],
        [-1, 52],
        [1, 40],
      ],
    ],
    [
      1,
      [
        [7, 28],
        [-1, 64],
        [3, 30],
      ],
    ],
    [
      1,
      [
        [2, 46],
        [-1, 30],
      ],
    ],
    [
      2,
      [
        [0, 30],
        [-1, 44],
        [1, 56],
        [-1, 20],
      ],
    ],
    [
      2,
      [
        [5, 38],
        [-1, 70],
      ],
    ],
    [1, [[7, 22]]],
    [
      0,
      [
        [0, 28],
        [-1, 38],
      ],
    ],
  ];
  const rows = lines.map(([indent, tokens], i) => {
    let cx = x + 44 + indent * 14;
    const ly = y + 34 + i * 19;
    const toks = tokens.map(([c, w]) => {
      const r = box(cx, ly, w, 6, 3, { fill: c < 0 ? t.bar : hue(k, c), "fill-opacity": c < 0 ? 1 : 0.9 });
      cx += w + 6;
      return r;
    });
    return label(x + 22, ly + 6, String(i + 1), t.muted, 8.5, 500, "end") + toks.join("");
  });
  const activeY = y + 34 + 4 * 19;
  drift(k, "d1", -6, 3);
  return [
    windowFrame(k, x, y, 384, 172),
    box(x + 1, activeY - 6, 382, 18, 0, { fill: hue(k, 5), "fill-opacity": 0.08 }),
    el("path", { d: `M${x + 32} ${y + 21}V${y + 172}`, stroke: t.line }),
    ...rows,
    caret(x + 44 + 28 + 38 + 6 + 70 + 4, activeY - 3, 12, hue(k, 5)),
    pointer(k, x + 196, activeY + 8, 5, "天青"),
    pointer(k, x + 300, y + 50, 1, "Madder", "d1"),
  ].join("");
}

/** Images: a picture swept from line sketch to colour, tile by tile. */
export function imageScene(k: Kit): string {
  const t = k.theme;
  const x = 100;
  const y = 28;
  const w = 280;
  const h = 178;
  // The sweep sits mid-sun so the same shape reads as finished colour on the left, sketch on the right.
  const split = x + 210;
  const sky = hue(k, 5);
  const amber = hue(k, 3);
  const green = hue(k, 10);
  const teal = hue(k, 2);
  const hills = `M${x} ${y + 128}C${x + 50} ${y + 96} ${x + 90} ${y + 104} ${x + 130} ${y + 118}S${x + 220} ${y + 84} ${x + w} ${y + 110}V${y + h}H${x}Z`;
  const front = `M${x} ${y + 150}C${x + 70} ${y + 128} ${x + 150} ${y + 160} ${x + w} ${y + 140}V${y + h}H${x}Z`;
  const sun = el("circle", { cx: x + 210, cy: y + 54, r: 20 });
  const tiles: string[] = [];
  for (let tx = x + 28; tx < split; tx += 28) tiles.push(`M${tx} ${y}V${y + h}`);
  for (let ty = y + 28; ty < y + h; ty += 28) tiles.push(`M${x} ${ty}H${split}`);
  drift(k, "d1", 0, 24, 4);
  return [
    el("clipPath", { id: "ic" }, box(x, y, w, h, 10, {})),
    el("clipPath", { id: "il" }, box(x, y, split - x, h, 0, {})),
    el("clipPath", { id: "ir" }, box(split, y, x + w - split, h, 0, {})),
    box(x, y, w, h, 10, { fill: t.surface, stroke: t.line }),
    el(
      "g",
      { "clip-path": "url(#ic)" },
      el(
        "g",
        { "clip-path": "url(#il)" },
        box(x, y, w, h, 0, { fill: sky, "fill-opacity": 0.22 }),
        el("g", { fill: amber }, sun),
        el("path", { d: hills, fill: teal, "fill-opacity": 0.75 }),
        el("path", { d: front, fill: green, "fill-opacity": 0.85 }),
        el("path", { d: tiles.join(""), stroke: t.surface, "stroke-opacity": 0.5, "stroke-width": 1 }),
      ),
      el(
        "g",
        { "clip-path": "url(#ir)", stroke: t.muted, "stroke-width": 1.3, fill: "none" },
        sun,
        el("path", { d: hills }),
        el("path", { d: front }),
      ),
      box(split - 1, y, 2, h, 0, { fill: hue(k, 0) }),
    ),
    pointer(k, split, y + 92, 0, "Indigo", "d1"),
    pill(x + 10, y + 10, "1600 × 1000", t.scheme === "dark" ? "#3A3A4C" : "#6C6C80", 9),
  ].join("");
}

/** 3D models: a wireframe solid with vertices, edges and a few shaded faces woven in. */
export function modelScene(k: Kit): string {
  const t = k.theme;
  const cx = 236;
  const cy = 122;
  // Isometric projection of a box, scale s.
  const s = 40;
  const iso = (x: number, y: number, z: number): [number, number] => [
    cx + (x - y) * s * 0.866,
    cy + (x + y) * s * 0.5 - z * s,
  ];
  const V = {
    a: iso(-1, -1, 0.9),
    b: iso(1, -1, 0.9),
    c: iso(1, 1, 0.9),
    d: iso(-1, 1, 0.9),
    e: iso(1, -1, -0.6),
    f: iso(1, 1, -0.6),
    g: iso(-1, 1, -0.6),
  };
  const p = (...pts: [number, number][]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
  const indigo = hue(k, 0);
  type Pt2 = [number, number];
  const edges: [Pt2, Pt2][] = [
    [V.a, V.b],
    [V.b, V.c],
    [V.c, V.d],
    [V.d, V.a],
    [V.b, V.e],
    [V.c, V.f],
    [V.d, V.g],
    [V.e, V.f],
    [V.f, V.g],
  ];
  const hidden = [iso(-1, -1, -0.6)];
  const [ha] = hidden as [[number, number]];
  drift(k, "d1", 5, -4);
  return [
    el("path", { d: p(V.a, V.b, V.c, V.d), fill: indigo, "fill-opacity": 0.85 }),
    el("path", { d: p(V.b, V.e, V.f, V.c), fill: indigo, "fill-opacity": 0.55 }),
    el("path", { d: p(V.c, V.f, V.g, V.d), fill: "url(#kc)" }),
    el("path", {
      d: `M${n(ha[0])} ${n(ha[1])}L${n(V.a[0])} ${n(V.a[1])}M${n(ha[0])} ${n(ha[1])}L${n(V.e[0])} ${n(V.e[1])}M${n(ha[0])} ${n(ha[1])}L${n(V.g[0])} ${n(V.g[1])}`,
      stroke: t.muted,
      "stroke-width": 1,
      "stroke-dasharray": "3 3",
    }),
    el("path", {
      d: edges.map(([u, v]) => `M${n(u[0])} ${n(u[1])}L${n(v[0])} ${n(v[1])}`).join(""),
      stroke: t.ink2,
      "stroke-width": 1.4,
      "stroke-linejoin": "round",
    }),
    el(
      "g",
      { fill: t.surface, stroke: t.ink2, "stroke-width": 1.4 },
      ...Object.values(V).map(([x, y]) => el("circle", { cx: x, cy: y, r: 3.2 })),
    ),
    // Axis gizmo.
    el("path", { d: "M60 186h26", stroke: hue(k, 8), "stroke-width": 2, "stroke-linecap": "round" }),
    el("path", { d: "M60 186v-26", stroke: hue(k, 10), "stroke-width": 2, "stroke-linecap": "round" }),
    el("path", { d: "M60 186l-14 10", stroke: hue(k, 5), "stroke-width": 2, "stroke-linecap": "round" }),
    pill(380, 40, "glTF", hue(k, 7), 9),
    pointer(k, V.c[0] + 2, V.c[1] + 2, 3, "Weld"),
    pointer(k, V.b[0] + 2, V.b[1] + 2, 7, "Logwood", "d1"),
  ].join("");
}

/** A device screen showing a tiny woven page and a cursor. */
function miniScreen(k: Kit, x: number, y: number, w: number, h: number, colorIndex: number): string {
  const t = k.theme;
  const u = Math.min(w, h);
  const m = u * 0.22;
  return [
    box(x, y, w, h, Math.max(2, u * 0.06), { fill: t.bg }),
    el(
      "g",
      { transform: `translate(${n(x + w * 0.12)} ${n(y + h * 0.14)}) scale(${n(m / MARK_GRID)})` },
      markBody(markStyles(k.palette).light, { id: `m${colorIndex}` }),
    ),
    bars(x + w * 0.12, y + h * 0.14 + m + u * 0.1, [w * 0.6, w * 0.44], t.bar, {
      h: Math.max(2, u * 0.05),
      gap: u * 0.1,
    }),
    cloth(x + w * 0.12, y + h * 0.66, w * 0.76, h * 0.2, 2),
  ].join("");
}

/** Every platform: laptop, tablet, phone and watch, each with its own swarm at work. */
export function platformScene(k: Kit): string {
  const t = k.theme;
  const frame = { fill: t.surface, stroke: t.line };
  drift(k, "d1", 4, -3);
  return [
    // Laptop.
    box(40, 44, 200, 128, 8, frame),
    miniScreen(k, 48, 52, 184, 112, 0),
    el("path", { d: "M26 174h228l-10 10H36z", fill: t.surface, stroke: t.line, "stroke-linejoin": "round" }),
    // Tablet.
    box(258, 60, 92, 124, 10, frame),
    miniScreen(k, 264, 66, 80, 112, 1),
    // Phone.
    box(362, 84, 50, 100, 10, frame),
    miniScreen(k, 366, 92, 42, 84, 2),
    // Watch.
    box(426, 136, 30, 36, 9, frame),
    miniScreen(k, 429, 139, 24, 30, 3),
    pointer(k, 176, 140, 0, "Indigo", "d1"),
    pointer(k, 318, 150, 1, "茜红"),
    pointer(k, 396, 154, 2),
    label(240, 204, "Chrome · Edge · Firefox · Safari · PWA · CLI", t.muted, 9.5, 500, "middle"),
  ].join("");
}

/** Video export: rendered frames on a film strip, the sound track below, and an export in progress. */
export function videoScene(k: Kit): string {
  const t = k.theme;
  const x = 44;
  const y = 34;
  const fw = 72;
  const fh = 48;
  const count = 5;
  const step = fw + 12;
  const frames = Array.from({ length: count }, (_, i) => {
    const fx = x + i * step;
    const built = (i + 1) / count;
    return [
      box(fx, y, fw, fh, 5, { fill: t.surface, stroke: t.line }),
      bars(fx + 8, y + 10, [36 * Math.min(1, built * 1.6)], t.ink, { h: 5 }),
      bars(fx + 8, y + 21, [52 * Math.min(1, built * 1.3), 40 * built], t.bar, { h: 3, gap: 7 }),
      built < 1 ? cloth(fx + 8, y + 36, 56, 6, 2) : box(fx + 8, y + 36, 56, 6, 2, { fill: hue(k, 0) }),
    ].join("");
  });
  const span = (count - 1) * step + fw;
  const bars_: string[] = [];
  const n_ = 52;
  const pitch = span / n_;
  const played = 30;
  for (let i = 0; i < n_; i++) {
    const hgt = 4 + ((Math.sin(i * 0.9) + 1) * 7 + ((i * 37) % 9)) * 0.9;
    bars_.push(
      box(x + i * pitch, y + 84 - hgt / 2, pitch * 0.5, hgt, pitch * 0.25, {
        fill: hue(k, 2),
        "fill-opacity": i < played ? 0.9 : 0.35,
      }),
    );
  }
  const head = x + played * pitch - pitch * 0.25;
  k.css.push(
    ".prog{transform-box:fill-box;transform-origin:0 50%;animation:prog 4s cubic-bezier(.65,0,.35,1) infinite}",
    "@keyframes prog{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.86)}}",
  );
  drift(k, "d1", -14, 0, 4);
  const bx = x;
  const by = y + 116;
  return [
    ...frames,
    ...bars_,
    el(
      "g",
      { class: "d1" },
      box(head, y - 6, 2, 112, 1, { fill: k.palette.accent }),
      el("circle", { cx: head + 1, cy: y - 6, r: 4, fill: k.palette.accent }),
      pointer(k, head + 4, y + 102, 4, "Tyrian"),
    ),
    box(bx, by, 236, 34, 8, { fill: t.surface, stroke: t.line }),
    label(bx + 14, by + 21, "MP4 · 1080p · 30 fps", t.ink2, 10, 600),
    box(bx + 140, by + 14, 82, 6, 3, { fill: t.placeholder }),
    box(bx + 140, by + 14, 60, 6, 3, { fill: hue(k, 0), class: "prog" }),
    selectBox(x, y, fw, fh, k.palette.select),
    pointer(k, bx + 202, by + 18, 0),
  ].join("");
}
