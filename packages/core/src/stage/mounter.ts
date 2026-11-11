import { createView, type LayerView, type MountEnv } from "./layers";
import type { LayerRegistry, Slot } from "./registry";

/** Layers are mounted while they are within this many viewport heights above or below the view. */
const MOUNT_MARGIN = 1.5;
/** ...and unmounted only once they are farther than this (hysteresis against scroll jitter). */
const UNMOUNT_MARGIN = 3;
/** Blueprints with at most this many DOM layers keep every mounted layer (re-mounting costs more). */
const KEEP_ALL_LAYERS = 400;
/** A layer a task touched within this many render frames stays mounted wherever it is. */
const TOUCH_FRAMES = 120;

/** Virtualization counters, for tests and diagnostics. */
export interface MountStats {
  /** DOM-rendered layers in the blueprint. */
  readonly domLayers: number;
  /** Layers mounted right now. */
  readonly mounted: number;
  /** Highest number of layers mounted at once. */
  readonly peak: number;
  /** Total mounts and unmounts since the stage was created. */
  readonly mounts: number;
  readonly unmounts: number;
  /** Virtualization passes run. */
  readonly passes: number;
  /** Layers whose mount threw (rendered as nothing, never retried). */
  readonly broken: number;
  /** True when the blueprint is small enough that mounted layers are never unmounted. */
  readonly keepAll: boolean;
}

/**
 * Mounts layer views into the world tree near the viewport and unmounts far ones that are not
 * being built. A layer's build state lives in its slot (progress, finished, transient styles), so a
 * re-mounted layer comes back exactly as it was; finished layers come back directly in their final
 * form, the cheapest static state a view has (no ghost, no typing wrappers, no dash setup).
 * Small blueprints (at most {@link KEEP_ALL_LAYERS} DOM layers) are cheap enough to keep whole.
 */
export class Mounter {
  readonly #reg: LayerRegistry;
  readonly #root: ShadowRoot;
  readonly #env: MountEnv;
  readonly #mounted: Slot[] = [];
  readonly #keepAll: boolean;
  readonly #batch: Slot[] = [];
  #stamp = 0;
  #frame = 0;
  #mounts = 0;
  #unmounts = 0;
  #passes = 0;
  #peak = 0;
  #broken = 0;
  #disposed = false;
  readonly #collect = (slot: Slot): void => {
    if (!slot.view && !slot.broken) this.#batch.push(slot);
  };

  constructor(registry: LayerRegistry, root: ShadowRoot, env: MountEnv, keepAllLimit = KEEP_ALL_LAYERS) {
    this.#reg = registry;
    this.#root = root;
    this.#env = env;
    this.#keepAll = registry.domCount <= keepAllLimit;
  }

  get stats(): MountStats {
    return {
      domLayers: this.#reg.domCount,
      mounted: this.#mounted.length,
      peak: this.#peak,
      mounts: this.#mounts,
      unmounts: this.#unmounts,
      passes: this.#passes,
      broken: this.#broken,
      keepAll: this.#keepAll,
    };
  }

  /** Mounted slots (for ready() and teardown). */
  get mounted(): readonly Slot[] {
    return this.#mounted;
  }

  /** Render frame counter used for touch expiry; the stage advances it once per render(). */
  set frame(f: number) {
    this.#frame = f;
  }

  /** Mounts `slot` now if it is a DOM layer that is not mounted (a task works on it). */
  ensure(slot: Slot): LayerView | null {
    if (slot.view || !slot.dom || slot.broken || this.#disposed) return slot.view;
    const view = this.#create(slot);
    if (!view) return null;
    this.#root.append(view.outer);
    this.#restore(slot, view);
    return slot.view;
  }

  /** True when `slot` lies in the band a pass for the visible stage band [top, bottom] mounts. */
  near(slot: Slot, top: number, bottom: number): boolean {
    const m = Math.max(1, bottom - top) * MOUNT_MARGIN;
    return slot.bottom >= top - m && slot.top <= bottom + m;
  }

  /**
   * One virtualization pass for the visible stage band [top, bottom] (stage px): mounts layers
   * within the mount margin with one DOM insertion, then unmounts far idle layers.
   */
  pass(top: number, bottom: number): void {
    if (this.#disposed) return;
    this.#passes++;
    const h = Math.max(1, bottom - top);
    this.#reg.query(top - h * MOUNT_MARGIN, bottom + h * MOUNT_MARGIN, ++this.#stamp, this.#collect);
    const batch = this.#batch;
    if (batch.length > 0) {
      const frag = this.#env.doc.createDocumentFragment();
      let n = 0;
      for (let i = 0; i < batch.length; i++) {
        const view = this.#create(batch[i] as Slot);
        if (view) {
          frag.append(view.outer);
          n++;
        }
      }
      if (n > 0) this.#root.append(frag);
      // State is applied after insertion: path lengths and text measurement need a rendered tree.
      for (let i = 0; i < batch.length; i++) {
        const slot = batch[i] as Slot;
        if (slot.view) this.#restore(slot, slot.view);
      }
      batch.length = 0;
    }
    if (!this.#keepAll) this.#sweep(top - h * UNMOUNT_MARGIN, bottom + h * UNMOUNT_MARGIN);
  }

  /** Unmounts every view (reset, destroy); slots keep their recorded state. */
  unmountAll(): void {
    const list = this.#mounted;
    for (let i = 0; i < list.length; i++) this.#destroy(list[i] as Slot);
    list.length = 0;
  }

  dispose(): void {
    this.unmountAll();
    this.#disposed = true;
  }

  #create(slot: Slot): LayerView | null {
    let view: LayerView | null = null;
    try {
      view = createView(this.#env, slot);
    } catch (error) {
      this.#fail(slot, error);
      return null;
    }
    if (!view) {
      slot.broken = true;
      return null;
    }
    slot.view = view;
    this.#mounted.push(slot);
    this.#mounts++;
    if (this.#mounted.length > this.#peak) this.#peak = this.#mounted.length;
    return view;
  }

  /** Brings a fresh view to the slot's recorded build state. */
  #restore(slot: Slot, view: LayerView): void {
    try {
      if (slot.finished) {
        view.finish();
        if (slot.css) view.transient(slot.css);
      } else {
        if (slot.css) view.transient(slot.css);
        if (slot.p > 0) view.reveal(slot.p);
      }
    } catch (error) {
      this.#fail(slot, error);
      this.#unmount(slot);
    }
  }

  #sweep(top: number, bottom: number): void {
    const list = this.#mounted;
    const frame = this.#frame;
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const slot = list[r] as Slot;
      const keep =
        (slot.bottom >= top && slot.top <= bottom) ||
        slot.view?.pinned === true ||
        slot.css !== null ||
        (slot.p > 0 && slot.p < 1 && !slot.finished) ||
        (slot.touched >= 0 && frame - slot.touched < TOUCH_FRAMES);
      if (keep) list[w++] = slot;
      else this.#destroy(slot);
    }
    list.length = w;
  }

  #unmount(slot: Slot): void {
    const i = this.#mounted.indexOf(slot);
    if (i >= 0) this.#mounted.splice(i, 1);
    this.#destroy(slot);
  }

  #destroy(slot: Slot): void {
    const view = slot.view;
    if (!view) return;
    slot.view = null;
    this.#unmounts++;
    try {
      view.destroy();
    } catch (error) {
      this.#fail(slot, error);
    }
    view.outer.remove();
  }

  #fail(slot: Slot, error: unknown): void {
    if (slot.broken) return;
    slot.broken = true;
    this.#broken++;
    console.warn(`SwarmLoom stage: layer "${slot.layer.id}" (${slot.layer.kind}) failed to render`, error);
  }
}
