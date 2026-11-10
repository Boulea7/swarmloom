import type { Layer, Rect } from "@swarmloom/core";

/** Lexicographic comparison of paint-order keys; a prefix paints below its extensions. */
export function compareKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Layers sorted into paint order (stable: equal keys keep emission order). */
export function paintOrder(layers: readonly Layer[], keys: readonly (readonly number[])[]): Layer[] {
  const idx = layers.map((_, i) => i);
  idx.sort((i, j) => compareKeys(keys[i] as readonly number[], keys[j] as readonly number[]) || i - j);
  return idx.map((i) => layers[i] as Layer);
}

export interface Truncation {
  layers: Layer[];
  dropped: number;
}

/** Vertical distance of a rect from the capture viewport (0 when they overlap). */
function distance(box: Rect, view: Rect): number {
  if (box.y + box.h < view.y) return view.y - (box.y + box.h);
  if (box.y > view.y + view.h) return box.y - (view.y + view.h);
  return 0;
}

/**
 * Keeps at most `max` layers: fixed (screen) UI first, then the capture viewport, then content by
 * distance from it, so far-away content is dropped rather than whatever comes last in the DOM. With
 * the page at the top this is plain reading order. Paint order is preserved among the kept layers and
 * references to dropped layers are repaired: `parent` moves to the nearest kept ancestor and
 * `master` is removed.
 */
export function truncate(layers: readonly Layer[], max: number, fixed: ReadonlySet<string>, view: Rect): Truncation {
  if (layers.length <= max) return { layers: [...layers], dropped: 0 };
  const ranked = layers.map((l, i) => ({ l, i, d: fixed.has(l.id) ? -1 : distance(l.box, view) }));
  ranked.sort(
    (a, b) => a.d - b.d || Math.round(a.l.box.y) - Math.round(b.l.box.y) || a.l.box.x - b.l.box.x || a.i - b.i,
  );
  const kept = new Set<string>();
  for (let k = 0; k < max; k++) kept.add((ranked[k] as { l: Layer }).l.id);
  const byId = new Map<string, Layer>();
  for (const l of layers) byId.set(l.id, l);
  const out: Layer[] = [];
  for (const l of layers) {
    if (!kept.has(l.id)) continue;
    let parent = l.parent;
    for (let guard = 0; parent && !kept.has(parent) && guard < 1000; guard++) parent = byId.get(parent)?.parent;
    if (parent !== l.parent) {
      if (parent) l.parent = parent;
      else delete l.parent;
    }
    if (l.master && !kept.has(l.master)) delete l.master;
    out.push(l);
  }
  return { layers: out, dropped: layers.length - out.length };
}
