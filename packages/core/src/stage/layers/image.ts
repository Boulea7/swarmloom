import { createRng } from "../../rng";
import type { ImageLayer, Rect, Size } from "../../types";
import { applyLayerStyle, isSafeUrl } from "../sanitize";
import { clamp01, contentDiv, hashString, type LayerView, type MountEnv, Shell, Transient } from "./common";
import { showStill } from "./still-image";

/*
 * Reveal geometry mirrors the image choreography (choreo/timing.ts) so the reveal follows the
 * operator: "type" goes line by line (`layer.lines`, else one per IMAGE_TYPE_LINE_H_PX, as in
 * imageTypeLines), "paint" follows a zig-zag brush over PAINT_ROW_PX rows. If those rules change
 * there, change them here.
 */
const TYPE_LINE_PX = 22;
const TYPE_LINES_MAX = 40;
const PAINT_ROW_PX = 90;
const PAINT_ROWS_MIN = 2;
const PAINT_ROWS_MAX = 6;
/** Width of one paint block, stage px. */
const PAINT_BLOCK_PX = 40;
const PAINT_BLOCKS_MAX = 48;

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

function finite(...v: number[]): boolean {
  for (const n of v) if (!Number.isFinite(n)) return false;
  return true;
}

function validCrop(c: Rect | undefined): c is Rect {
  return !!c && finite(c.x, c.y, c.w, c.h) && c.w > 0 && c.h > 0;
}

function validSize(s: Size | undefined): s is Size {
  return !!s && finite(s.w, s.h) && s.w > 0 && s.h > 0;
}

/** Places `img` so that the source rect `crop` fills a w x h box. */
function placeCrop(img: HTMLImageElement, crop: Rect, natural: Size, w: number, h: number): void {
  const sx = w / crop.w;
  const sy = h / crop.h;
  const s = img.style;
  s.position = "absolute";
  s.maxWidth = "none";
  s.left = `${-crop.x * sx}px`;
  s.top = `${-crop.y * sy}px`;
  s.width = `${natural.w * sx}px`;
  s.height = `${natural.h * sy}px`;
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** Polygon covering the full lines above a line plus its first `x` px. */
function typePolygon(w: number, lineTop: number, lineBottom: number, x: number): string {
  return (
    `polygon(0 0,${f1(w)}px 0,${f1(w)}px ${f1(lineTop)}px,${f1(x)}px ${f1(lineTop)}px,` +
    `${f1(x)}px ${f1(lineBottom)}px,0 ${f1(lineBottom)}px)`
  );
}

/** Seeded vertical overhang of each paint block (fraction of the row height), so edges look brushed. */
function paintJitter(count: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(count * 2);
  for (let i = 0; i < out.length; i++) out[i] = 0.04 + rng() * 0.16;
  return out;
}

/**
 * Raster/vector image, optionally a crop of a larger bitmap (rendered pages). Reveals:
 * "sweep" (default, top to bottom), "type" (line by line, left to right: PDF text regions),
 * "fade", "paint" (blocks laid along a zig-zag brush path). An animated source (SVG, GIF, APNG,
 * WebP, AVIF) is swapped for a still copy (see still-image.ts) before decode() settles, so no frame
 * depends on the browser clock.
 */
export function mountImage(env: MountEnv, layer: ImageLayer, z: number): LayerView {
  const doc = env.doc;
  const shell = new Shell(env, layer, z);
  const content = contentDiv(doc);
  content.style.overflow = "hidden";
  applyLayerStyle(content, layer.style);
  const img = doc.createElement("img");
  img.decoding = "async";
  img.draggable = false;
  img.alt = "";
  const b = layer.box;
  const w = Math.max(0, b.w);
  const h = Math.max(0, b.h);
  const crop = validCrop(layer.crop) ? layer.crop : null;
  if (crop) {
    if (validSize(layer.natural)) placeCrop(img, crop, layer.natural, w, h);
    else {
      img.style.position = "absolute";
      img.addEventListener("load", () => placeCrop(img, crop, { w: img.naturalWidth, h: img.naturalHeight }, w, h), {
        once: true,
      });
    }
  } else {
    const s = img.style;
    s.display = "block";
    s.width = "100%";
    s.height = "100%";
    s.maxWidth = "none";
    s.objectFit = layer.fit === "contain" || layer.fit === "cover" ? layer.fit : "fill";
  }
  let gone = false;
  let settled: Promise<void> | null = null;
  // An animated bitmap data: URL, a same-origin file or a blob: URL shows at once and is swapped for
  // its still copy once decoded or fetched.
  const still =
    typeof layer.src === "string" && isSafeUrl(layer.src) ? showStill(img, layer.src, doc, () => gone) : null;
  content.append(img);
  shell.shell.append(content);

  const mode = layer.reveal === "fade" || layer.reveal === "paint" || layer.reveal === "type" ? layer.reveal : "sweep";
  const transient = new Transient();
  const lines = clampInt(
    typeof layer.lines === "number" && layer.lines >= 1 ? layer.lines : h / TYPE_LINE_PX,
    1,
    TYPE_LINES_MAX,
  );
  const rows = clampInt(h / PAINT_ROW_PX, PAINT_ROWS_MIN, PAINT_ROWS_MAX);
  const cols = clampInt(w / PAINT_BLOCK_PX, 3, PAINT_BLOCKS_MAX);
  let jitter: Float32Array | null = null;
  let lastKey = Number.NaN;

  // Reveal clips run on the shell, so transient styles on the content element never fight them.
  const clip = (value: string): void => {
    shell.shell.style.clipPath = value;
  };

  const paintClip = (p: number): void => {
    const pos = p * rows;
    const row = Math.min(rows - 1, Math.floor(pos));
    const k = Math.min(cols, Math.round((pos - row) * cols));
    const key = row * (cols + 1) + k;
    if (key === lastKey) return;
    lastKey = key;
    jitter ??= paintJitter(rows * cols, (hashString(layer.id) ^ env.seed) >>> 0);
    const rh = h / rows;
    const bw = w / cols;
    const top = row * rh;
    let d = top > 0 ? `M0 0H${f1(w)}V${f1(top)}H0Z` : "";
    const leftToRight = row % 2 === 0;
    for (let i = 0; i < k; i++) {
      const c = leftToRight ? i : cols - 1 - i;
      const j = (row * cols + c) * 2;
      const up = (jitter[j] ?? 0) * rh;
      const down = (jitter[j + 1] ?? 0) * rh;
      const x0 = c * bw - 0.5;
      d += `M${f1(x0)} ${f1(top - up)}H${f1(x0 + bw + 1)}V${f1(top + rh + down)}H${f1(x0)}Z`;
    }
    clip(d ? `path("${d}")` : "inset(0 0 100% 0)");
  };

  return {
    outer: shell.outer,
    el: content,
    reveal(p) {
      if (!(p > 0)) {
        shell.setVisible(false);
        return;
      }
      shell.setVisible(true);
      if (p >= 1) {
        if (lastKey !== -1) clip("");
        lastKey = -1;
        shell.alpha(1);
        return;
      }
      const t = clamp01(p);
      switch (mode) {
        case "fade":
          shell.alpha(t);
          break;
        case "sweep": {
          shell.alpha(1);
          const bottom = Math.round((1 - t) * 10000) / 100;
          if (bottom !== lastKey) {
            lastKey = bottom;
            clip(`inset(0 0 ${bottom}% 0)`);
          }
          break;
        }
        case "type": {
          shell.alpha(1);
          const pos = t * lines;
          const line = Math.min(lines - 1, Math.floor(pos));
          const x = Math.round((pos - line) * w);
          const key = line * (w + 2) + x;
          if (key !== lastKey) {
            lastKey = key;
            const lh = h / lines;
            clip(typePolygon(w, line * lh, (line + 1) * lh, x));
          }
          break;
        }
        case "paint":
          shell.alpha(1);
          paintClip(t);
          break;
      }
    },
    finish() {
      transient.clear(content);
      this.reveal(1);
    },
    transient(css) {
      transient.apply(content, css);
    },
    decode() {
      const decoded = (): Promise<void> =>
        img.src
          ? img.decode().then(
              () => undefined,
              () => undefined,
            )
          : Promise.resolve();
      // Once: the image does not change after its still copy is in place, and an export asks
      // before every engine tick.
      settled ??= still ? still.then(decoded) : decoded();
      return settled;
    },
    destroy() {
      gone = true;
      jitter = null;
    },
  };
}
