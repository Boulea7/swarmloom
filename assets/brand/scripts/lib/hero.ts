import { CURSOR_PATH, cursorDefs, nameTag, textWidth, UI_FONT } from "./cursor.ts";
import { LOGOTYPE_METRICS } from "./glyphs.ts";
import { type Box, placeLogotype } from "./logotype.ts";
import { MARK_GRID, markBody, markStyles } from "./mark.ts";
import { EASE_IN_OUT, EASE_OUT, type Frame, keyframes, motionOnly, move, rng } from "./motion.ts";
import { cursorColor, type Palette } from "./palette.ts";
import { el, esc, n, type Pt, pt, svgDoc } from "./svg.ts";
import type { Theme } from "./theme.ts";

/** Artboard of the README hero banner. */
export const HERO = { width: 1280, height: 420, seconds: 8, radius: 24 } as const;

/** Loop timeline, as fractions of {@link HERO.seconds}. Frame 0 is the finished banner. */
const TL = {
  holdEnd: 0.06,
  unravelStagger: 0.004,
  unravelFor: 0.03,
  buildStart: 0.15,
  buildStagger: 0.046,
  grabFor: 0.015,
  carryFor: 0.095,
  settleFor: 0.012,
  restBy: 0.9,
} as const;

/** The six weavers of the banner: palette index and name tag (dye names, mixed zh/en on purpose). */
const WEAVERS = [
  { color: 0, name: "Indigo" },
  { color: 1, name: "茜红" },
  { color: 2, name: "铜绿" },
  { color: 3, name: "Weld" },
  { color: 4, name: "Tyrian" },
  { color: 5, name: "天青" },
] as const;

/** Build order: which weaver carries each item (mark, nine glyphs, two tagline lines). */
const CARRIER = [5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4] as const;

/** Something a cursor carries into place. */
interface Item {
  markup: string;
  box: Box;
  /** Where the cursor tip holds the item, in final coordinates. */
  grab: Pt;
  /** Offset of the pickup position from the final position, and the tilt while carried. */
  off: Pt;
  tilt: number;
  /** Index of the carrying weaver. */
  carrier: number;
  /** Loop fraction at which the grab starts. */
  t: number;
}

interface Layout {
  items: Item[];
  /** Resting hotspot of each weaver (frame 0 and the end of the loop). */
  rest: Pt[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function layout(p: Palette, theme: Theme): Layout {
  const scale = 1.2;
  const markSize = 104;
  const gap = 30;
  const textW = LOGOTYPE_METRICS.width * scale;
  const x0 = (HERO.width - (markSize + gap + textW)) / 2;
  const cy = 166;
  const cap = LOGOTYPE_METRICS.capHeight * scale;
  const baseline = cy + cap / 2;
  const markY = cy - markSize / 2;
  const style = markStyles(p)[theme.scheme];

  const raw: { markup: string; box: Box }[] = [];
  raw.push({
    markup: el(
      "g",
      { transform: `translate(${n(x0)} ${n(markY)}) scale(${n(markSize / MARK_GRID)})` },
      markBody(style, { id: "hm", weftClass: "wf" }),
    ),
    box: { x: x0, y: markY, w: markSize, h: markSize },
  });
  for (const g of placeLogotype(x0 + markSize + gap, baseline, scale)) {
    raw.push({ markup: el("path", { d: g.d, fill: theme.ink }), box: g.box });
  }
  const zh = p.tagline.zh;
  const zhSize = 24;
  const zhW = [...zh].length * zhSize;
  const zhBase = 270;
  raw.push({
    markup: `<text x="640" y="${zhBase}" text-anchor="middle" font-size="${zhSize}" font-weight="500" fill="${theme.ink2}" letter-spacing=".5">${esc(zh)}</text>`,
    box: { x: 640 - zhW / 2, y: zhBase - zhSize * 0.9, w: zhW, h: zhSize * 1.1 },
  });
  const en = p.tagline.en;
  const enSize = 15;
  const enW = Math.round(textWidth(en, enSize) * 0.98);
  const enBase = 302;
  raw.push({
    markup: `<text x="640" y="${enBase}" text-anchor="middle" font-size="${enSize}" font-weight="500" fill="${theme.muted}" textLength="${enW}" lengthAdjust="spacing">${esc(en)}</text>`,
    box: { x: 640 - enW / 2, y: enBase - enSize * 0.8, w: enW, h: enSize * 1.05 },
  });
  if (raw.length !== CARRIER.length) throw new Error(`hero expects ${CARRIER.length} items, got ${raw.length}`);

  const random = rng(20261110);
  const items = raw.map(({ markup, box }, k): Item => {
    // The cursor holds each piece near its lower right, so the name tag trails below the piece.
    const grab = pt(box.x + box.w * 0.72, box.y + box.h * 0.78);
    // Pickups: the mark comes in from the left, glyphs alternate from above and below, the tagline from below.
    const jitter = (random() - 0.5) * 120;
    const lift = 110 + random() * 50;
    const raw =
      k === 0
        ? pt(-150, (random() - 0.5) * 80)
        : k <= 9
          ? pt(jitter, k % 2 ? -lift : lift)
          : pt(jitter, 70 + random() * 30);
    const off = pt(
      clamp(raw.x, 24 - box.x, HERO.width - 110 - box.x - box.w),
      clamp(raw.y, 24 - box.y, HERO.height - 56 - box.y - box.h),
    );
    const tilt = (random() - 0.5) * 16;
    return { markup, box, grab, off, tilt, carrier: CARRIER[k] ?? 0, t: TL.buildStart + TL.buildStagger * k };
  });

  const end = x0 + markSize + gap + textW;
  const capTop = baseline - cap;
  const glyph = (i: number) => items[1 + i]?.box ?? { x: 0, y: 0, w: 0, h: 0 };
  const rest = [
    pt(end + 16, capTop + 8), // Indigo: just finished the last letter
    pt(640 - zhW / 2 - 76, zhBase - 34), // coral: before the Chinese line
    pt(640 + zhW / 2 + 18, zhBase - 4), // teal: after the Chinese line
    pt(glyph(5).x + 10, capTop - 46), // amber: above the "L"
    pt(end - 128, enBase + 26), // orchid: below the end of the English line
    pt(x0 - 58, markY + 6), // sky: beside the mark
  ];
  return { items, rest };
}

function itemFrames(item: Item, k: number): Frame[] {
  const u = TL.holdEnd + TL.unravelStagger * k;
  const gone = move(0, 6);
  const lifted = move(item.off.x, item.off.y, item.tilt);
  const grabbed = item.t + TL.grabFor;
  return [
    { at: 0, props: { opacity: "1", transform: "none" } },
    { at: u, props: { opacity: "1", transform: "none" }, ease: EASE_OUT },
    { at: u + TL.unravelFor, props: { opacity: "0", transform: gone } },
    { at: item.t, props: { opacity: "0", transform: lifted } },
    { at: grabbed, props: { opacity: "1", transform: lifted }, ease: EASE_OUT },
    { at: grabbed + TL.carryFor, props: { opacity: "1", transform: "none" } },
    { at: 1, props: { opacity: "1", transform: "none" } },
  ];
}

function selectionFrames(item: Item): Frame[] {
  const off = { opacity: "0" };
  const on = { opacity: "1" };
  const drop = item.t + TL.grabFor + TL.carryFor;
  return [
    { at: 0, props: off },
    { at: item.t, props: off },
    { at: item.t + 0.006, props: on },
    { at: drop + TL.settleFor * 0.5, props: on },
    { at: drop + TL.settleFor * 1.5, props: off },
    { at: 1, props: off },
  ];
}

function weaverFrames(w: number, items: Item[], rest: Pt): { travel: Frame[]; press: Frame[] } {
  const travel: Frame[] = [
    { at: 0, props: { transform: move(rest.x, rest.y) } },
    { at: TL.holdEnd, props: { transform: move(rest.x, rest.y) }, ease: EASE_IN_OUT },
  ];
  const press: Frame[] = [{ at: 0, props: { transform: "none" } }];
  for (const item of items.filter((it) => it.carrier === w)) {
    const pick = pt(item.grab.x + item.off.x, item.grab.y + item.off.y);
    const grabbed = item.t + TL.grabFor;
    const drop = grabbed + TL.carryFor;
    travel.push(
      { at: item.t - 0.004, props: { transform: move(pick.x, pick.y) } },
      { at: grabbed, props: { transform: move(pick.x, pick.y) }, ease: EASE_OUT },
      { at: drop, props: { transform: move(item.grab.x, item.grab.y) } },
      { at: drop + TL.settleFor, props: { transform: move(item.grab.x, item.grab.y) }, ease: EASE_IN_OUT },
    );
    press.push(
      { at: item.t, props: { transform: "none" } },
      { at: item.t + 0.006, props: { transform: "scale(.86)" } },
      { at: drop, props: { transform: "scale(.86)" } },
      { at: drop + 0.008, props: { transform: "none" } },
    );
  }
  travel.push(
    { at: TL.restBy, props: { transform: move(rest.x, rest.y) } },
    { at: 1, props: { transform: move(rest.x, rest.y) } },
  );
  press.push({ at: 1, props: { transform: "none" } });
  return { travel, press };
}

/** Selection outline with round "knot" handles, drawn around an item while it is carried. */
function selection(box: Box, color: string): string {
  const pad = 6;
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.w + pad * 2;
  const h = box.h + pad * 2;
  const knots = [pt(x, y), pt(x + w, y), pt(x, y + h), pt(x + w, y + h)]
    .map((c) => el("circle", { cx: c.x, cy: c.y, r: 2.6 }))
    .join("");
  return (
    el("rect", { x, y, width: w, height: h, rx: 3, stroke: color, "stroke-width": 1.5, fill: "none" }) +
    el("g", { fill: "#FFFFFF", stroke: color, "stroke-width": 1.5 }, knots)
  );
}

/** Faint vertical warp threads, fading out behind the lockup so the wordmark sits on clean cloth. */
function background(theme: Theme): string {
  const { width: w, height: h, radius } = HERO;
  let warp = "";
  for (let x = 20; x < w; x += 20) warp += `M${x} 0V${h}`;
  return [
    el(
      "defs",
      {},
      el(
        "radialGradient",
        { id: "hf", cx: 0.5, cy: 0.47, r: 0.56, gradientTransform: "matrix(1 0 0 .55 0 .21)" },
        el("stop", { offset: 0.45, "stop-color": theme.bg }),
        el("stop", { offset: 1, "stop-color": theme.bg, "stop-opacity": 0 }),
      ),
      el("clipPath", { id: "hc" }, el("rect", { width: w, height: h, rx: radius })),
    ),
    el("rect", { width: w, height: h, rx: radius, fill: theme.bg }),
    el("path", { d: warp, stroke: theme.faint, "stroke-width": 1, "clip-path": "url(#hc)" }),
    el("rect", { class: "a fo", width: w, height: h, fill: "url(#hf)" }),
    el("rect", { x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: radius - 0.5, stroke: theme.line, fill: "none" }),
  ].join("");
}

/**
 * Animated README banner: six named cursors unravel and re-weave the SwarmLoom lockup on an 8 s loop.
 * Pure CSS keyframes, no scripts or external resources. The un-animated state (frame 0, reduced motion,
 * renderers without CSS animation) is the finished banner.
 */
export function heroSvg(p: Palette, theme: Theme): string {
  const { items, rest } = layout(p, theme);
  const base = [
    ".it{transform-box:fill-box;transform-origin:50% 50%}",
    ".s{opacity:0}",
    `text{font-family:${UI_FONT}}`,
  ];
  const css: string[] = [
    `.a{animation-duration:${HERO.seconds}s;animation-iteration-count:infinite;animation-timing-function:linear}`,
  ];
  const art: string[] = [];
  items.forEach((item, k) => {
    const color = cursorColor(p, WEAVERS[item.carrier]?.color ?? 0);
    css.push(`.i${k}{animation-name:i${k}}`, keyframes(`i${k}`, itemFrames(item, k)));
    css.push(`.s${k}{animation-name:s${k}}`, keyframes(`s${k}`, selectionFrames(item)));
    art.push(
      el("g", { class: `a it i${k}` }, item.markup, el("g", { class: `a s s${k}` }, selection(item.box, color))),
    );
  });
  // The mark's coral weft is drawn in after the mark lands.
  const mark = items[0];
  if (mark) {
    const start = mark.t + TL.grabFor + TL.carryFor;
    css.push(
      ".wf{stroke-dasharray:1;animation-name:wf}",
      keyframes("wf", [
        { at: 0, props: { "stroke-dashoffset": "0" } },
        { at: TL.holdEnd + TL.unravelFor, props: { "stroke-dashoffset": "0" } },
        { at: TL.holdEnd + TL.unravelFor + 0.001, props: { "stroke-dashoffset": "1" } },
        { at: start, props: { "stroke-dashoffset": "1" }, ease: EASE_OUT },
        { at: start + 0.06, props: { "stroke-dashoffset": "0" } },
        { at: 1, props: { "stroke-dashoffset": "0" } },
      ]),
    );
  }
  const weavers = WEAVERS.map((w, i) => {
    const color = cursorColor(p, w.color);
    const at = rest[i] ?? pt(0, 0);
    const { travel, press } = weaverFrames(i, items, at);
    css.push(`.c${i}{animation-name:c${i}}`, keyframes(`c${i}`, travel));
    css.push(`.p${i}{animation-name:p${i}}`, keyframes(`p${i}`, press));
    const arrow = el("path", {
      d: CURSOR_PATH,
      fill: color,
      stroke: "#FFFFFF",
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "paint-order": "stroke",
    });
    return el(
      "g",
      { class: `a c${i}`, transform: `translate(${n(at.x)} ${n(at.y)})`, filter: "url(#hs)" },
      el("g", { class: `a p${i}` }, arrow),
      nameTag(w.name, color),
    );
  });
  // While the swarm works the clean centre fades away and the loom's warp shows through.
  css.push(
    ".fo{animation-name:fo}",
    keyframes("fo", [
      { at: 0, props: { opacity: "1" } },
      { at: TL.holdEnd, props: { opacity: "1" }, ease: EASE_OUT },
      { at: TL.holdEnd + 0.08, props: { opacity: "0" } },
      { at: TL.restBy - 0.08, props: { opacity: "0" }, ease: EASE_IN_OUT },
      { at: TL.restBy + 0.04, props: { opacity: "1" } },
      { at: 1, props: { opacity: "1" } },
    ]),
  );
  const body = [
    background(theme),
    el("defs", {}, cursorDefs("hs", theme.scheme === "dark" ? 1.6 : 1)),
    art.join(""),
    weavers.join(""),
  ].join("");
  return svgDoc(body, {
    width: HERO.width,
    height: HERO.height,
    title: `${p.name} (${p.nameZh}): ${p.tagline.en}`,
    style: base.join("") + motionOnly(css),
  });
}
