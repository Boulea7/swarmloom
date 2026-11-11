import type { CustomLayer, Layer, Rect, Size } from "@swarmloom/core";
import { NEUTRALS, PLAYER_TASK } from "./constants";
import type { LottieInfo } from "./lottie/model";
import { type LottiePlayerData, solidColor } from "./player/data";
import { type AnimTimelineData, TIMELINE_TASK } from "./timeline/data";

/** The composition is fitted so it is at most this tall relative to the world width. */
const MAX_ASPECT = 0.75;
/** Height of the strip under the composition that holds the timeline, px. */
const BAND_H = 56;
/** Timeline box height inside the strip, px. */
const TIMELINE_H = 36;
/** Narrowest timeline bar, px. */
const MIN_TIMELINE_W = 240;
/** Margin kept on both sides of the timeline, px. */
const SIDE_MARGIN = 8;

/** Layer ids of the two layers the adapter adds to the woven pose. */
export const PLAYER_ID = "lottie-player";
export const TIMELINE_ID = "lottie-timeline";

/** Where things go in the stage world. */
export interface Layout {
  world: Size;
  /** Composition rectangle (the woven pose and the player). */
  comp: Rect;
  /** Timeline box under the composition. */
  timeline: Rect;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Fits a composition into a world `width` px wide: scaled to the width, or smaller and centred
 * when it would be taller than 3/4 of the width, with the timeline strip underneath.
 */
export function layoutFor(comp: Size, width: number): Layout {
  const w = Math.max(1, Math.round(width));
  const s = Math.min(w / comp.w, (w * MAX_ASPECT) / comp.h);
  const cw = round2(comp.w * s);
  const ch = round2(comp.h * s);
  const rect: Rect = { x: round2((w - cw) / 2), y: 0, w: cw, h: ch };
  const tw = round2(Math.min(w - 2 * SIDE_MARGIN, Math.max(cw, Math.min(MIN_TIMELINE_W, w - 2 * SIDE_MARGIN))));
  const timeline: Rect = { x: round2((w - tw) / 2), y: round2(ch + (BAND_H - TIMELINE_H) / 2), w: tw, h: TIMELINE_H };
  return { world: { w, h: Math.ceil(ch + BAND_H) }, comp: rect, timeline };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bottom > y ? { x, y, w: r - x, h: bottom - y } : null;
}

function inside(a: Rect, b: Rect, eps = 0.5): boolean {
  return a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;
}

/**
 * A solid rectangle filling the whole composition at the bottom of the paint order (a Lottie
 * solid layer): its colour becomes the stage background so the strip around the composition
 * matches it.
 */
function canvasFill(layer: Layer | undefined, comp: Rect): string | null {
  if (layer?.kind !== "path" || layer.meta?.tag !== "rect") return null;
  if (layer.stroke || layer.attrs || layer.transform || layer.clip) return null;
  if (layer.opacity !== undefined && layer.opacity < 1) return null;
  const fill = solidColor(layer.fill);
  if (fill === "transparent" || !inside(comp, layer.box) || !inside(layer.box, comp)) return null;
  return fill;
}

/** Channels of a #rgb, #rgba, #rrggbb or #rrggbbaa colour: r, g, b 0-255 and alpha 0-1, or null. */
function hexChannels(color: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  return [r, g, b, full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1];
}

/**
 * The dotLottie manifest background as an opaque stage colour: a translucent one is composited
 * over the paper, a fully transparent or unreadable one gives null.
 */
function manifestBackground(color: string | undefined): string | null {
  const rgba = color === undefined ? null : hexChannels(color);
  const paper = hexChannels(NEUTRALS.paper);
  if (!rgba || rgba[3] === 0 || !paper) return null;
  const a = rgba[3];
  const mix = (i: 0 | 1 | 2): number => Math.round(rgba[i] * a + paper[i] * (1 - a));
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** Relative luminance of a hex or rgb() colour, or null. */
export function luminance(color: string): number | null {
  let rgb: number[] | null = null;
  const hex = hexChannels(color);
  if (hex) {
    rgb = hex.slice(0, 3);
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb || rgb.some((v) => !Number.isFinite(v))) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Inputs of {@link assembleLayers}. */
export interface AssembleInput {
  /** Layers converted from the woven frame (SVG adapter output, world coordinates). */
  woven: Layer[];
  layout: Layout;
  info: LottieInfo;
  /** Sanitised Lottie JSON. */
  json: string;
  /** Woven frame index (from the in point). */
  rest: number;
  /** Keyframe times, composition frames. */
  keyTimes: readonly number[];
  loop: boolean | number;
  speed: number;
  /** Background colour from the dotLottie manifest (hex), painted under the whole animation. */
  background?: string;
}

/** The blueprint layers and the background colour. */
export interface Assembled {
  layers: Layer[];
  background: string;
  scheme: "light" | "dark";
}

/**
 * Builds the blueprint layers: the woven pose (clipped to the composition, its canvas solid
 * folded into the background; without one the manifest background is used), then the
 * `lottie:player` layer over the composition, built first and invisible until the timeline
 * drives it, and the `anim:timeline` layer under it, built last (after the last woven layer).
 */
export function assembleLayers(input: AssembleInput): Assembled {
  const { layout, info } = input;
  const comp = layout.comp;
  const woven = [...input.woven];
  const firstDrawn = woven.findIndex((l) => l.kind !== "custom");
  const canvas = canvasFill(woven[firstDrawn], comp);
  if (canvas) woven.splice(firstDrawn, 1);
  // A canvas solid is drawn over the manifest background, so it wins.
  const background = canvas ?? manifestBackground(input.background) ?? NEUTRALS.paper;
  const lum = luminance(background);
  const scheme = lum !== null && lum < 0.4 ? "dark" : "light";

  const layers: Layer[] = [];
  let maxZ = 0;
  let maxPriority = 0;
  let lastId: string | undefined;
  for (const layer of woven) {
    if (layer.kind !== "custom") {
      const visible = intersect(layer.box, layer.clip ?? comp);
      const clip = visible ? intersect(visible, comp) : null;
      if (!clip) continue;
      if (!inside(layer.box, comp)) layer.clip = layer.clip ? (intersect(layer.clip, comp) ?? clip) : comp;
      const p = layer.priority ?? 0;
      if (lastId === undefined || p >= maxPriority) {
        maxPriority = p;
        lastId = layer.id;
      }
    }
    maxZ = Math.max(maxZ, layer.z ?? 0);
    layers.push(layer);
  }

  const fr = info.fr;
  const toMs = (frame: number): number => Math.round((frame * 1000 * 1000) / fr) / 1000;
  const count = Math.max(1, Math.floor(info.op - info.ip));
  const duration = toMs(count);
  const player: CustomLayer = {
    id: PLAYER_ID,
    kind: "custom",
    task: PLAYER_TASK,
    box: { ...comp },
    z: maxZ + 1,
    priority: Math.min(-2, ...layers.map((l) => (l.priority ?? 0) - 1)),
    data: {
      json: input.json,
      rest: info.ip + input.rest,
      loop: input.loop,
      speed: input.speed,
      background,
    } satisfies LottiePlayerData,
  };
  const timelineData: AnimTimelineData = {
    target: PLAYER_ID,
    duration,
    keyframes: input.keyTimes.map((t) => toMs(t - info.ip)).filter((t) => t >= 0 && t <= duration),
    rest: toMs(input.rest),
    scheme,
  };
  const timeline: CustomLayer = {
    id: TIMELINE_ID,
    kind: "custom",
    task: TIMELINE_TASK,
    box: { ...layout.timeline },
    z: maxZ + 2,
    priority: maxPriority + 1,
    data: timelineData,
  };
  if (lastId !== undefined) timeline.parent = lastId;
  layers.push(player, timeline);
  return { layers, background, scheme };
}
