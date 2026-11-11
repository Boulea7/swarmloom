import type { CSSMap, GuideLayer, Layer, Rect } from "../types";
import type { LayerView } from "./layers/common";

const DOM_KINDS = new Set(["box", "text", "path", "image", "media", "custom"]);
/** Height of one band of the vertical index, stage px. */
const BAND_PX = 1024;
/** A layer spanning more bands than this is kept in a short "tall" list instead (page backgrounds). */
const MAX_BANDS_PER_LAYER = 8;
/** Bands beyond this index (absurd coordinates) also go to the tall list. */
const MAX_BAND = 1 << 16;

/** Build and mount state of one blueprint layer. */
export interface Slot {
  readonly layer: Layer;
  /** Dense paint rank, unique: Layer.z (default: blueprint index), ties broken by blueprint order. */
  readonly z: number;
  /** Vertical extent used for virtualization (layer box, cut by its clip), stage px. */
  readonly top: number;
  readonly bottom: number;
  /** Rendered as DOM: a DOM kind with a finite box and a unique id. */
  readonly dom: boolean;
  view: LayerView | null;
  /** Last reveal progress, 0..1. */
  p: number;
  finished: boolean;
  /** Transient styles currently applied (re-applied when the layer is mounted again). */
  css: CSSMap | null;
  /** Render frame of the last StageApi call on this layer (keeps it mounted while a task works on it). */
  touched: number;
  /** Mounting threw once; the layer is not retried (local degradation, never the whole stage). */
  broken: boolean;
  /** De-duplication stamp of range queries. */
  stamp: number;
}

/** A guide layer with a usable axis and position (drawn on the overlay canvas, never DOM). */
export interface GuideSlot extends Slot {
  readonly layer: GuideLayer;
}

function isFiniteRect(r: unknown): r is Rect {
  if (typeof r !== "object" || r === null) return false;
  const b = r as Record<string, unknown>;
  return (
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.w === "number" &&
    typeof b.h === "number" &&
    Number.isFinite(b.x + b.y + b.w + b.h) &&
    b.w >= 0 &&
    b.h >= 0
  );
}

function isLayer(l: unknown): l is Layer {
  return typeof l === "object" && l !== null && typeof (l as Layer).id === "string" && (l as Layer).id.length > 0;
}

/**
 * Every layer of a blueprint with its build state, looked up by id, plus a vertical band index so
 * virtualization only visits layers near the viewport. Malformed entries are kept out of the DOM
 * (they can still be looked up when they have an id) rather than failing the whole stage.
 */
export class LayerRegistry {
  readonly slots: Slot[] = [];
  readonly guides: GuideSlot[] = [];
  /** Guide slot -> layers that snap to it. */
  readonly dependents = new Map<GuideSlot, Slot[]>();
  /** Number of DOM-rendered layers. */
  readonly domCount: number;
  readonly #byId = new Map<string, Slot>();
  readonly #bands: Slot[][] = [];
  readonly #tall: Slot[] = [];

  constructor(layers: readonly unknown[]) {
    const valid: Layer[] = [];
    for (const l of layers) if (isLayer(l)) valid.push(l);
    const order = valid.map((_, i) => i);
    const zOf = (i: number): number => {
      const z = valid[i]?.z;
      return typeof z === "number" && Number.isFinite(z) ? z : i;
    };
    order.sort((a, b) => zOf(a) - zOf(b) || a - b);
    const rank = new Int32Array(valid.length);
    for (let r = 0; r < order.length; r++) rank[order[r] ?? 0] = r + 1;

    let domCount = 0;
    for (let i = 0; i < valid.length; i++) {
      const layer = valid[i] as Layer;
      const unique = !this.#byId.has(layer.id);
      const boxed = isFiniteRect(layer.box);
      const dom = unique && boxed && DOM_KINDS.has(layer.kind);
      let top = boxed ? layer.box.y : 0;
      let bottom = boxed ? layer.box.y + layer.box.h : -1;
      if (boxed && isFiniteRect(layer.clip)) {
        top = Math.max(top, layer.clip.y);
        bottom = Math.min(bottom, layer.clip.y + layer.clip.h);
      }
      const slot: Slot = {
        layer,
        z: rank[i] ?? i + 1,
        top,
        bottom,
        dom,
        view: null,
        p: 0,
        finished: false,
        css: null,
        touched: -1,
        broken: false,
        stamp: 0,
      };
      this.slots.push(slot);
      if (!unique) continue;
      this.#byId.set(layer.id, slot);
      if (dom) {
        domCount++;
        this.#index(slot);
      } else if (layer.kind === "guide" && (layer.axis === "x" || layer.axis === "y") && Number.isFinite(layer.pos)) {
        this.guides.push(slot as GuideSlot);
      }
    }
    this.domCount = domCount;

    for (const g of this.guides) this.dependents.set(g, []);
    for (const slot of this.slots) {
      const snaps = slot.layer.snaps;
      if (!Array.isArray(snaps)) continue;
      for (const id of snaps) {
        const g = typeof id === "string" ? this.#byId.get(id) : undefined;
        const list = g ? this.dependents.get(g as GuideSlot) : undefined;
        if (list && g !== slot) list.push(slot);
      }
    }
  }

  get(id: string): Slot | undefined {
    return typeof id === "string" ? this.#byId.get(id) : undefined;
  }

  /**
   * Calls `fn` once for every DOM slot whose vertical extent intersects [top, bottom]. `stamp` must
   * differ between calls (it de-duplicates layers listed in several bands).
   */
  query(top: number, bottom: number, stamp: number, fn: (slot: Slot) => void): void {
    const b0 = Math.max(0, Math.floor(top / BAND_PX));
    const b1 = Math.min(this.#bands.length - 1, Math.floor(bottom / BAND_PX));
    for (let b = b0; b <= b1; b++) {
      const band = this.#bands[b];
      if (band) visit(band, top, bottom, stamp, fn);
    }
    visit(this.#tall, top, bottom, stamp, fn);
  }

  #index(slot: Slot): void {
    if (slot.bottom < slot.top) return;
    const b0 = Math.max(0, Math.floor(slot.top / BAND_PX));
    const b1 = Math.max(b0, Math.floor(slot.bottom / BAND_PX));
    if (b1 - b0 >= MAX_BANDS_PER_LAYER || b1 > MAX_BAND) {
      this.#tall.push(slot);
      return;
    }
    for (let b = b0; b <= b1; b++) {
      let band = this.#bands[b];
      if (!band) {
        band = [];
        this.#bands[b] = band;
      }
      band.push(slot);
    }
  }
}

function visit(list: readonly Slot[], top: number, bottom: number, stamp: number, fn: (slot: Slot) => void): void {
  for (let i = 0; i < list.length; i++) {
    const s = list[i] as Slot;
    if (s.stamp === stamp || s.bottom < top || s.top > bottom) continue;
    s.stamp = stamp;
    fn(s);
  }
}
