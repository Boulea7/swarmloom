import type { Layer, MediaLayer, Rect } from "@swarmloom/core";
import type { PendingShot } from "../capture/state";
import { intersect } from "../util/geom";

export interface Screenshot {
  src: string;
  scrollX: number;
  scrollY: number;
  dpr: number;
}

/** Elements larger than this (CSS px area) are not cropped: the bitmap would be mostly empty. */
const MAX_AREA = 4096 * 4096;

async function decode(doc: Document, src: string): Promise<HTMLImageElement | null> {
  const img = doc.createElement("img");
  img.decoding = "async";
  img.src = src;
  try {
    await img.decode();
    return img.naturalWidth > 0 ? img : null;
  } catch {
    return null;
  }
}

function crop(doc: Document, img: HTMLImageElement, shot: Screenshot, view: Rect, full: Rect): string | null {
  const bounds: Rect = { x: 0, y: 0, w: img.naturalWidth / shot.dpr, h: img.naturalHeight / shot.dpr };
  const visible = intersect(view, bounds);
  if (!visible || full.w * full.h > MAX_AREA) return null;
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(full.w * shot.dpr));
  canvas.height = Math.max(1, Math.round(full.h * shot.dpr));
  const g = canvas.getContext("2d");
  if (!g) return null;
  const d = shot.dpr;
  g.drawImage(
    img,
    visible.x * d,
    visible.y * d,
    visible.w * d,
    visible.h * d,
    (visible.x - view.x) * d,
    (visible.y - view.y) * d,
    visible.w * d,
    visible.h * d,
  );
  const complete = visible.w >= view.w - 0.5 && visible.h >= view.h - 0.5;
  // Fully visible crops are opaque; partial ones keep the unseen part transparent.
  return complete ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/webp", 0.9);
}

/**
 * Fills media placeholders (WebGL canvases, videos, cross-origin frames) with crops of the
 * viewport screenshot. Pending rects are in document coordinates at capture time (viewport
 * coordinates for fixed elements), so a screenshot taken at a different scroll offset still maps.
 * Failures leave the placeholder untouched.
 */
export async function applyScreenshot(
  doc: Document,
  shot: Screenshot,
  pending: readonly PendingShot[],
  layers: readonly Layer[],
): Promise<number> {
  if (pending.length === 0) return 0;
  const img = await decode(doc, shot.src);
  if (!img) return 0;
  const byId = new Map<string, Layer>();
  for (const l of layers) byId.set(l.id, l);
  let applied = 0;
  for (const p of pending) {
    const layer = byId.get(p.id);
    if (layer?.kind !== "media") continue;
    const view: Rect = p.fixed
      ? p.rect
      : { x: p.rect.x - shot.scrollX, y: p.rect.y - shot.scrollY, w: p.rect.w, h: p.rect.h };
    try {
      const src = crop(doc, img, shot, view, p.rect);
      if (src) {
        (layer as MediaLayer).src = src;
        applied++;
      }
    } catch {
      // Out of memory or a tainted bitmap: keep the labelled placeholder.
    }
  }
  return applied;
}
