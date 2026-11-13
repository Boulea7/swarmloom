import { animationMark, animationsOf, same, sheetState } from "./reads";
import { type CanvasMark, canvasDataUrl, type ScrollMark, type SnapshotSource } from "./snapshot";

/** What a {@link StillWatch} reads: the frame document, its watched shadow roots and FontFace faces. */
export type StillSource = Pick<SnapshotSource, "document" | "shadowRoots" | "faces">;

/** Events that can change a frame without a mutation: resource loads, popovers and details. */
const CHANGE_EVENTS = ["load", "error", "toggle"] as const;

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

/**
 * What else the look of a frame depends on, besides its DOM, scroll offsets and the text of its
 * rules, read by value: FontFace faces, the font sets of its documents, and focus, the style sheets
 * that apply and the Web Animations of each document and shadow root. Null while a font loads or an
 * animation runs, as both change the frame on the wall clock.
 */
function stateOf(
  source: StillSource,
  docs: readonly Document[],
  targets: readonly (Document | ShadowRoot)[],
): unknown[] | null {
  const state: unknown[] = [source.faces().length];
  for (const doc of docs) {
    const fonts = doc.fonts;
    if (fonts?.status === "loading") return null;
    state.push(fonts?.size);
  }
  for (const target of targets) {
    state.push(target.activeElement, ...sheetState([target], false));
    const animations = animationsOf(target);
    state.push(animations.length);
    for (const animation of animations) {
      const look = animationMark(animation).state;
      if (look === null) return null;
      state.push(animation, look.length, ...look);
    }
  }
  return state;
}

/**
 * Tells whether a frame document still shows what a snapshot of it read, without walking it again.
 * Created before the walk, so a change during it counts too. Nothing of the page is intercepted:
 * each change is either observed or read by value. The frame shows the same while nothing in the
 * document, its shadow roots or the documents of its same-origin frames (see
 * {@link frameDocuments}) mutated; no image, style sheet or font loaded in any of them; no popover
 * or details element toggled; the shadow roots, frame documents, FontFace faces and focus are those
 * of the start; each tree has the same style sheets with the same text in their rules (`sheetText`,
 * so an edit through the CSSOM counts however it was made; read only when the watch is created with
 * `texts`, else the frame never counts as still); each Web Animation (none running) shows what it
 * showed then (`animationMark`); the scroll offsets the walk read have not moved; and each canvas
 * whose pixels went into the image gives the same data URL ({@link settle}). What the walk
 * marks as changing on its own (videos, frames of another origin, shadow roots the source does not
 * list, SMIL) the snapshot reports instead (`FrameSnapshot.settled`). Not watched: what only a
 * script of the page changes without a mutation (form control values, custom element states,
 * registered custom properties); no page script runs in an export, and the render page changes none
 * of them between frames.
 */
export class StillWatch {
  readonly #source: StillSource;
  readonly #docs: readonly Document[];
  readonly #targets: readonly (Document | ShadowRoot)[];
  readonly #roots: readonly ShadowRoot[];
  readonly #frames: readonly Document[];
  readonly #observer: MutationObserver;
  readonly #state: unknown[] | null;
  readonly #texts: unknown[] | null;
  #scrolls: readonly ScrollMark[] | null = null;
  #pixels: readonly CanvasMark[] = [];
  #changed = false;
  readonly #mark = (): void => {
    this.#changed = true;
  };

  /** `texts`: read the text of the rules now (see {@link StillWatch}). */
  constructor(source: StillSource, texts: boolean) {
    this.#source = source;
    const doc = source.document;
    this.#roots = Array.from(source.shadowRoots());
    this.#frames = frameDocuments([doc, ...this.#roots]);
    this.#docs = [doc, ...this.#frames];
    this.#targets = [doc, ...this.#roots, ...this.#frames];
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    this.#observer = new (win?.MutationObserver ?? MutationObserver)(this.#mark);
    for (const target of this.#targets) {
      this.#observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
      for (const type of CHANGE_EVENTS) target.addEventListener(type, this.#mark, true);
    }
    for (const d of this.#docs) d.fonts?.addEventListener("loadingdone", this.#mark);
    this.#state = stateOf(source, this.#docs, this.#targets);
    this.#texts = texts ? sheetState(this.#targets, true) : null;
  }

  /**
   * The scroll offsets and the canvas pixels the snapshot read; until this is called the frame
   * never counts as still.
   */
  settle(scrolls: readonly ScrollMark[], pixels: readonly CanvasMark[]): void {
    this.#scrolls = scrolls;
    this.#pixels = pixels;
  }

  /**
   * Whether the frame changes by itself: a mutation, a load, a toggle or a font load happened since
   * the start, or an animation was running or a font loading at the start.
   */
  get busy(): boolean {
    if (!this.#changed && this.#observer.takeRecords().length > 0) this.#changed = true;
    return this.#changed || !this.#state;
  }

  /** Whether the document still shows what the snapshot read. */
  still(): boolean {
    if (this.busy || !this.#scrolls || !this.#state) return false;
    const roots = Array.from(this.#source.shadowRoots());
    if (!same(this.#roots, roots)) return false;
    if (!same(this.#frames, frameDocuments([this.#source.document, ...roots]))) return false;
    for (const { el, left, top } of this.#scrolls) {
      if (el.scrollLeft !== left || el.scrollTop !== top) return false;
    }
    const state = stateOf(this.#source, this.#docs, this.#targets);
    if (state === null || !same(this.#state, state)) return false;
    if (!this.#texts || !same(this.#texts, sheetState(this.#targets, true))) return false;
    // Last: encoding a canvas costs the most of these checks.
    return this.#pixels.every(({ canvas, url }) => canvasDataUrl(canvas) === url);
  }

  stop(): void {
    this.#observer.disconnect();
    for (const target of this.#targets) {
      for (const type of CHANGE_EVENTS) target.removeEventListener(type, this.#mark, true);
    }
    for (const d of this.#docs) d.fonts?.removeEventListener("loadingdone", this.#mark);
  }
}
