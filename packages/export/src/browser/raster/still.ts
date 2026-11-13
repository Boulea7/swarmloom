import { animationMark, animationsOf, focusState, same, sheetState } from "./reads";
import {
  type CanvasMark,
  canvasDataUrl,
  type FrameSnapshot,
  type ScrollMark,
  type SizeMark,
  type SnapshotSource,
} from "./snapshot";

/** What a {@link StillWatch} reads: the frame document, its watched shadow roots and FontFace faces. */
export type StillSource = Pick<SnapshotSource, "document" | "shadowRoots" | "faces">;

/**
 * Events that can change a frame without a mutation: resource loads, and popovers and details
 * opening or closing. A popover sets no attribute: `beforetoggle` fires as it opens or closes, in
 * the same task, while `toggle` only follows in a later one.
 */
const CHANGE_EVENTS = ["load", "error", "beforetoggle", "toggle"] as const;

/** Longest wait for the page's next rendering update ({@link StillWatch.rendered}). */
const RENDER_WAIT_MS = 1000;

/**
 * Documents of the same-origin frames in `scopes` and, in turn, in those documents, in tree order:
 * the walk draws each into its frame's box (a live page shown on go live, for one). Frames of
 * another origin, whose document cannot be read, are left out; the walk reports them itself.
 */
function frameDocuments(scopes: readonly (Document | ShadowRoot)[]): Document[] {
  const docs: Document[] = [];
  const queue: (Document | ShadowRoot)[] = [...scopes];
  // The loop also reaches the documents pushed while it runs.
  for (const scope of queue) {
    for (const frame of Array.from(scope.querySelectorAll("iframe"))) {
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        doc = null;
      }
      if (!doc || docs.includes(doc)) continue;
      docs.push(doc);
      queue.push(doc);
    }
  }
  return docs;
}

/** A document or shadow root the watch reads. */
type Tree = Document | ShadowRoot;

/**
 * What else the look of a tree depends on, besides its DOM, scroll offsets and the text of its
 * rules, read by value: a document's font set, focus (`focusState`), the style sheets that apply
 * and the Web Animations. Null while a font loads or an animation runs, as both change the frame on
 * the wall clock.
 */
function treeState(tree: Tree): unknown[] | null {
  const state: unknown[] = [];
  if (tree.nodeType === 9) {
    const fonts = (tree as Document).fonts;
    if (fonts?.status === "loading") return null;
    state.push(fonts?.size);
  }
  state.push(...focusState(tree), ...sheetState([tree], false));
  const animations = animationsOf(tree);
  state.push(animations.length);
  for (const animation of animations) {
    const look = animationMark(animation).state;
    if (look === null) return null;
    state.push(animation, look.length, ...look);
  }
  return state;
}

/**
 * Tells whether a frame document still shows what a snapshot of it read, without walking it again.
 * Created before the walk, so a change during it counts too. Nothing of the page is intercepted:
 * each change is either observed or read by value. It reads the document, its shadow roots and the
 * documents of the same-origin frames (see {@link frameDocuments}) the walk drew, with their shadow
 * roots: nothing of a frame left out shows, and it shows only after a change in the trees around
 * it. Until the walk tells which ({@link settle}), it reads those the last walk drew. The frame
 * shows the same while nothing in those trees mutated; no image, style sheet or font loaded in any
 * of them; no popover or details element toggled; the shadow roots, frame documents and FontFace
 * faces are those of the start; and these read the same: focus (`focusState`), the font sets, the
 * style sheets of each tree with the text of their rules (`sheetText`, so an edit through the CSSOM
 * counts however it was made; read only when the watch is created with `texts`, else the frame
 * never counts as still), what each Web Animation shows (`animationMark`; none may run), and what
 * the snapshot read: the scroll offsets, the size of each box written empty and the data URL of
 * each canvas whose pixels went into the image. What the walk marks as changing on its own
 * (videos, frames of another origin, shadow roots the source does not list, SMIL, images still
 * loading) the snapshot reports instead (`FrameSnapshot.settled`). Not watched: what only a script
 * of the page changes without a mutation (form control values, custom element states, registered
 * custom properties, keyframes set on a CSS animation or transition); no page script runs in an
 * export, and the render page changes none of them between frames. Nor what the engine takes at a
 * rendering update from the layout and scroll offsets it sees then (scroll-state container
 * queries, anchor positions): it changes only at a rendering update after one of the changes
 * above, which the watch tells ({@link rendered}) for the caller to read the frame again.
 */
export class StillWatch {
  readonly #source: StillSource;
  readonly #roots: readonly ShadowRoot[];
  /** The same-origin frame documents at the start, and those of them read. */
  readonly #all: readonly Document[];
  #frames: readonly Document[];
  #trees: readonly Tree[];
  readonly #observer: MutationObserver;
  readonly #faces: number;
  /** {@link treeState} and, with `texts`, `sheetState` with the rule text of each tree at the start. */
  readonly #states = new Map<Tree, unknown[] | null>();
  readonly #texts: Map<Tree, unknown[]> | null;
  #scrolls: readonly ScrollMark[] | null = null;
  #sizes: readonly SizeMark[] = [];
  #pixels: readonly CanvasMark[] = [];
  #changed = false;
  readonly #mark = (): void => {
    this.#changed = true;
  };
  /** The animation frame request that tells a rendering update (see {@link rendered}), 0 without one. */
  readonly #frame: number = 0;
  #updated = false;
  #waited = false;
  #onUpdate: (() => void) | null = null;

  /**
   * `texts`: read the text of the rules now (see {@link StillWatch}). `drawn`: the frame documents
   * the last snapshot drew (`FrameSnapshot.frames`), null to read every one.
   */
  constructor(source: StillSource, texts: boolean, drawn: readonly Document[] | null) {
    this.#source = source;
    const doc = source.document;
    this.#roots = Array.from(source.shadowRoots());
    this.#all = frameDocuments([doc, ...this.#roots]);
    this.#frames = drawn ? this.#all.filter((frame) => drawn.includes(frame)) : this.#all;
    this.#trees = this.#treesOf(this.#frames);
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    this.#observer = new (win?.MutationObserver ?? MutationObserver)(this.#mark);
    this.#listen(this.#trees, true);
    this.#faces = source.faces().length;
    for (const tree of this.#trees) this.#states.set(tree, treeState(tree));
    this.#texts = texts ? new Map(this.#trees.map((tree) => [tree, sheetState([tree], true)])) : null;
    if (typeof win?.requestAnimationFrame === "function") {
      // The engine lays the page out after the animation frame callbacks and takes what it keeps
      // until the next update; a task queued from one runs once all that is done.
      this.#frame = win.requestAnimationFrame(() => {
        win.setTimeout(() => {
          this.#updated = true;
          this.#onUpdate?.();
        }, 0);
      });
    }
  }

  /**
   * Takes what the snapshot read by value, and stops reading the frames it left out; until this is
   * called the frame never counts as still. False, and the watch stops, when the snapshot did not
   * settle or drew a frame document the watch does not read.
   */
  settle(snapshot: Pick<FrameSnapshot, "settled" | "sizes" | "pixels" | "frames">): boolean {
    const { settled, frames } = snapshot;
    if (!settled || frames.some((frame) => !this.#frames.includes(frame))) {
      this.stop();
      return false;
    }
    if (frames.length < this.#frames.length) this.#leave(frames);
    this.#scrolls = settled;
    this.#sizes = snapshot.sizes;
    this.#pixels = snapshot.pixels;
    return true;
  }

  /**
   * Whether the frame changed since the start: a mutation, a load, a toggle or a font load happened,
   * {@link still} read a value that differs (scroll offsets, sizes, what an animation shows, as a
   * seeked one does on every frame after going live, rule text, canvas pixels), or an animation
   * was running or a font loading at the start.
   */
  get busy(): boolean {
    if (!this.#changed && this.#observer.takeRecords().length > 0) this.#changed = true;
    if (this.#changed) return true;
    for (const state of this.#states.values()) if (!state) return true;
    return false;
  }

  /**
   * Whether the document still shows what the snapshot read: false once something changed or a
   * value reads differently (the frame is then {@link busy}), null when nothing did but the watch
   * has no rule text to compare.
   */
  still(): boolean | null {
    if (this.busy || !this.#scrolls) return false;
    const reads = this.#reads();
    if (reads === false) this.#changed = true;
    return reads;
  }

  /**
   * Whether the page took a rendering update since the start. The first call waits for the next
   * one (up to {@link RENDER_WAIT_MS}) unless the document is hidden, which takes none.
   */
  async rendered(): Promise<boolean> {
    if (this.#updated || this.#waited) return this.#updated;
    this.#waited = true;
    const doc = this.#source.document;
    if (!doc.defaultView || !this.#frame || doc.visibilityState === "hidden") return false;
    await new Promise<void>((resolve) => {
      // This realm's timer: a frame removed meanwhile runs neither its animation frames nor its timers.
      const timer = setTimeout(resolve, RENDER_WAIT_MS);
      this.#onUpdate = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    return this.#updated;
  }

  stop(): void {
    this.#observer.disconnect();
    this.#listen(this.#trees, false);
    if (this.#frame && !this.#updated) this.#source.document.defaultView?.cancelAnimationFrame(this.#frame);
  }

  /**
   * Whether what the watch reads by value reads the same again; null when nothing differs but the
   * watch has no rule text to compare.
   */
  #reads(): boolean | null {
    const roots = Array.from(this.#source.shadowRoots());
    if (!same(this.#roots, roots)) return false;
    if (!same(this.#all, frameDocuments([this.#source.document, ...roots]))) return false;
    if (this.#source.faces().length !== this.#faces) return false;
    for (const { el, left, top } of this.#scrolls ?? []) {
      if (el.scrollLeft !== left || el.scrollTop !== top) return false;
    }
    for (const { el, width, height } of this.#sizes) {
      const r = el.getBoundingClientRect();
      if (r.width !== width || r.height !== height) return false;
    }
    for (const [tree, state] of this.#states) {
      const now = treeState(tree);
      if (!state || !now || !same(state, now)) return false;
    }
    if (!this.#texts) return null;
    for (const [tree, text] of this.#texts) if (!same(text, sheetState([tree], true))) return false;
    // Last: encoding a canvas costs the most of these checks.
    return this.#pixels.every(({ canvas, url }) => canvasDataUrl(canvas) === url);
  }

  /** The frame document, the shadow roots in it or in `frames`, then `frames`. */
  #treesOf(frames: readonly Document[]): Tree[] {
    const doc = this.#source.document;
    const roots = this.#roots.filter((root) => root.ownerDocument === doc || frames.includes(root.ownerDocument));
    return [doc, ...roots, ...frames];
  }

  /** Observes the DOM, events and font loads of `trees`, or stops listening to their events. */
  #listen(trees: readonly Tree[], on: boolean): void {
    for (const tree of trees) {
      if (on) this.#observer.observe(tree, { subtree: true, childList: true, attributes: true, characterData: true });
      for (const type of CHANGE_EVENTS) {
        if (on) tree.addEventListener(type, this.#mark, true);
        else tree.removeEventListener(type, this.#mark, true);
      }
      if (tree.nodeType !== 9) continue;
      const fonts = (tree as Document).fonts;
      if (on) fonts?.addEventListener("loadingdone", this.#mark);
      else fonts?.removeEventListener("loadingdone", this.#mark);
    }
  }

  /** Reads only the frame documents in `frames` (and the trees in them) from now on. */
  #leave(frames: readonly Document[]): void {
    const kept = this.#treesOf(frames);
    // A change in a tree left out shows nowhere.
    for (const record of this.#observer.takeRecords()) {
      if (kept.includes(record.target.getRootNode() as Tree)) this.#changed = true;
    }
    this.#observer.disconnect();
    this.#listen(this.#trees, false);
    this.#frames = frames;
    this.#trees = kept;
    this.#listen(kept, true);
    for (const tree of Array.from(this.#states.keys())) {
      if (kept.includes(tree)) continue;
      this.#states.delete(tree);
      this.#texts?.delete(tree);
    }
  }
}
