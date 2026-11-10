import type { ImageLayer, Layer, PathLayer, Rect, Size } from "@swarmloom/core";
import type { Analysis, Stroke, Tile } from "./kernel";

/** Where and how the image sits in the world. */
export interface Placement {
  /** World size (stage px). */
  world: Size;
  /** Image rectangle in the world, integer px. */
  rect: Rect;
}

export interface LayerStyle {
  /** Pencil colour of sketch strokes. */
  pencil: string;
  /** Canvas colour; tiles and the final image sit on it so transparent pixels cover the sketch. */
  background: string;
}

export interface ImageAsset {
  /** URL of the image shown by tiles and the final layer. */
  src: string;
  /** Pixel size of `src`. */
  natural: Size;
}

/**
 * Fits an image of `natural` size into a world `width` wide: never wider than the world, at most
 * `maxUpscale` times its natural size, and at most `maxHeightRatio * width` tall. The image is
 * centred horizontally; the world is exactly as tall as the image.
 */
export function placeImage(natural: Size, width: number, maxUpscale: number, maxHeightRatio: number): Placement {
  const scale = Math.min(width / natural.w, maxUpscale, (width * maxHeightRatio) / natural.h);
  const w = Math.max(1, Math.min(width, Math.round(natural.w * scale)));
  const h = Math.max(1, Math.round(natural.h * scale));
  const x = Math.floor((width - w) / 2);
  return { world: { w: width, h }, rect: { x, y: 0, w, h } };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Smooth path through polyline points: straight to the first midpoint, quadratic segments through
 * the midpoints with the original vertices as controls, straight to the last point. The pen anchors
 * of the stage choreography land on the midpoints, so strokes read as hand-drawn curves.
 */
export function smoothPath(points: readonly number[]): string {
  const n = points.length >> 1;
  if (n === 0) return "";
  const x = (i: number): number => points[i * 2] as number;
  const y = (i: number): number => points[i * 2 + 1] as number;
  let d = `M${round2(x(0))} ${round2(y(0))}`;
  if (n === 1) return d;
  if (n === 2) return `${d}L${round2(x(1))} ${round2(y(1))}`;
  d += `L${round2((x(0) + x(1)) / 2)} ${round2((y(0) + y(1)) / 2)}`;
  for (let i = 1; i < n - 1; i++) {
    d += `Q${round2(x(i))} ${round2(y(i))} ${round2((x(i) + x(i + 1)) / 2)} ${round2((y(i) + y(i + 1)) / 2)}`;
  }
  return `${d}L${round2(x(n - 1))} ${round2(y(n - 1))}`;
}

function strokeLayer(
  stroke: Stroke,
  index: number,
  analysis: Analysis,
  place: Placement,
  style: LayerStyle,
): Omit<PathLayer, "id" | "z" | "priority"> | null {
  const sx = place.rect.w / analysis.width;
  const sy = place.rect.h / analysis.height;
  const pts: number[] = new Array(stroke.points.length);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < stroke.points.length; i += 2) {
    // Pixel centres, so a stroke along the last column stays inside the image.
    const px = place.rect.x + ((stroke.points[i] as number) + 0.5) * sx;
    const py = place.rect.y + ((stroke.points[i + 1] as number) + 0.5) * sy;
    pts[i] = px;
    pts[i + 1] = py;
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  }
  const scale = Math.min(1.5, Math.max(0.75, place.rect.w / 800));
  const width = round2((0.8 + 1.6 * stroke.strength) * scale);
  const pad = width / 2 + 0.5;
  const bx = Math.max(place.rect.x, x0 - pad);
  const by = Math.max(place.rect.y, y0 - pad);
  const box = {
    x: round2(bx),
    y: round2(by),
    w: round2(Math.min(place.rect.x + place.rect.w, x1 + pad) - bx),
    h: round2(Math.min(place.rect.y + place.rect.h, y1 + pad) - by),
  };
  if (!(box.w > 0 && box.h > 0)) return null;
  return {
    kind: "path",
    box,
    d: smoothPath(pts),
    stroke: style.pencil,
    strokeWidth: width,
    fill: "none",
    attrs: {
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-opacity": String(round2(0.5 + 0.45 * stroke.strength)),
    },
    reveal: "pen",
    role: "sketch",
    meta: { sketch: true, strength: round2(stroke.strength), rank: index },
  };
}

/** Stage rect of a working-space tile; edges are rounded so neighbours share them (no seams). */
function tileRect(t: Tile, analysis: Analysis, place: Placement): Rect {
  const ex = (x: number): number => place.rect.x + Math.round((x * place.rect.w) / analysis.width);
  const ey = (y: number): number => place.rect.y + Math.round((y * place.rect.h) / analysis.height);
  const x = ex(t.x);
  const y = ey(t.y);
  return { x, y, w: ex(t.x + t.w) - x, h: ey(t.y + t.h) - y };
}

/**
 * Builds the layers of an analysed image:
 * 1. pencil sketch strokes (path layers, drawn with the pen, `meta.sketch = true`), strongest first;
 * 2. quadtree tiles (image layers cropping the picture, `reveal: "paint"`), bigger tiles first;
 * 3. the whole picture fading in on top, which makes the last frame pixel-exact.
 */
export function buildLayers(analysis: Analysis, place: Placement, asset: ImageAsset, style: LayerStyle): Layer[] {
  const layers: Layer[] = [];
  const push = (layer: Omit<Layer, "id" | "z" | "priority">, prefix: string): void => {
    const n = layers.length;
    layers.push({ ...layer, id: `${prefix}-${n + 1}`, z: n, priority: n } as Layer);
  };

  analysis.strokes.forEach((s, i) => {
    const layer = strokeLayer(s, i, analysis, place, style);
    if (layer) push(layer, "sketch");
  });

  const kx = asset.natural.w / place.rect.w;
  const ky = asset.natural.h / place.rect.h;
  const tiles = analysis.tiles
    .map((t) => ({ t, r: tileRect(t, analysis, place) }))
    .filter(({ r }) => r.w > 0 && r.h > 0)
    .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h || a.r.y - b.r.y || a.r.x - b.r.x);
  for (const { t, r } of tiles) {
    const tile: Omit<ImageLayer, "id" | "z" | "priority"> = {
      kind: "image",
      box: r,
      src: asset.src,
      natural: asset.natural,
      crop: {
        x: round2((r.x - place.rect.x) * kx),
        y: round2((r.y - place.rect.y) * ky),
        w: round2(r.w * kx),
        h: round2(r.h * ky),
      },
      fit: "fill",
      style: { "background-color": style.background },
      reveal: "paint",
      role: "figure",
      meta: { tile: true, colour: t.colour, detail: Math.round(t.detail) },
    };
    push(tile, "tile");
  }

  const final: Omit<ImageLayer, "id" | "z" | "priority"> = {
    kind: "image",
    box: { ...place.rect },
    src: asset.src,
    natural: asset.natural,
    fit: "fill",
    style: { "background-color": style.background },
    reveal: "fade",
    role: "figure",
    meta: { final: true },
  };
  push(final, "image");
  return layers;
}
