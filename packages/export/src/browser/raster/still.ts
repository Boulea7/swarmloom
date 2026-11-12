import { type CanvasMark, canvasDataUrl, type ScrollMark, type SnapshotSource } from "./snapshot";

/** What a {@link StillWatch} reads: the frame document, its watched shadow roots and FontFace faces. */
export type StillSource = Pick<SnapshotSource, "document" | "shadowRoots" | "faces">;

/** Resource loads that can change a frame without a mutation (images, style sheets, frames). */
const LOAD_EVENTS = ["load", "error"] as const;

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
 * What else the look of a frame depends on, besides its DOM and scroll offsets: FontFace faces,
 * the font sets of its documents, focus, adopted style sheets and Web Animations, read from each
 * document and shadow root. Null while a font loads or an animation runs, as both change the frame
 * on the wall clock.
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
    state.push(target.activeElement);
    const sheets = target.adoptedStyleSheets ?? [];
    state.push(sheets.length);
    for (const sheet of sheets) state.push(sheet, ruleCount(sheet));
    const animations = typeof target.getAnimations === "function" ? target.getAnimations() : [];
    state.push(animations.length);
    for (const animation of animations) {
      if (animation.playState === "running") return null;
      state.push(animation, animation.playState, animation.currentTime);
    }
  }
  return state;
}

function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length;
  } catch {
    return -1;
  }
}

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * Tells whether a frame document still shows what a snapshot of it read, without walking it
 * again. Created before the walk, so a change during it counts too. The frame shows the same while:
 * nothing in the document, its shadow roots or the documents of its same-origin frames (see
 * {@link frameDocuments}) mutated; no image, style sheet or font loaded in any of them; the shadow
 * roots, frame documents, FontFace faces, focus, adopted style sheets and Web Animations (none
 * running) are those of the start; the scroll offsets the walk read have not moved; and each canvas
 * whose pixels went into the image gives the same data URL ({@link settle}). What the walk marks as
 * changing on its own (videos, frames of another origin, shadow roots the source does not list,
 * SMIL) the snapshot reports instead (`FrameSnapshot.settled`). Not watched: form control values
 * and rules edited inside a style sheet through the CSSOM, which the render page never changes
 * between frames.
 */
export class StillWatch {
  readonly #source: StillSource;
  readonly #docs: readonly Document[];
  readonly #targets: readonly (Document | ShadowRoot)[];
  readonly #roots: readonly ShadowRoot[];
  readonly #frames: readonly Document[];
  readonly #observer: MutationObserver;
  readonly #state: unknown[] | null;
  #scrolls: readonly ScrollMark[] | null = null;
  #pixels: readonly CanvasMark[] = [];
  #changed = false;
  readonly #mark = (): void => {
    this.#changed = true;
  };

  constructor(source: StillSource) {
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
      for (const type of LOAD_EVENTS) target.addEventListener(type, this.#mark, true);
    }
    for (const d of this.#docs) d.fonts?.addEventListener("loadingdone", this.#mark);
    this.#state = stateOf(source, this.#docs, this.#targets);
  }

  /**
   * The scroll offsets and the canvas pixels the snapshot read; until this is called the frame
   * never counts as still.
   */
  settle(scrolls: readonly ScrollMark[], pixels: readonly CanvasMark[]): void {
    this.#scrolls = scrolls;
    this.#pixels = pixels;
  }

  /** Whether the document still shows what the snapshot read. */
  still(): boolean {
    if (this.#changed || !this.#scrolls || !this.#state) return false;
    if (this.#observer.takeRecords().length > 0) {
      this.#changed = true;
      return false;
    }
    const roots = Array.from(this.#source.shadowRoots());
    if (!same(this.#roots, roots)) return false;
    if (!same(this.#frames, frameDocuments([this.#source.document, ...roots]))) return false;
    for (const { el, left, top } of this.#scrolls) {
      if (el.scrollLeft !== left || el.scrollTop !== top) return false;
    }
    const state = stateOf(this.#source, this.#docs, this.#targets);
    if (state === null || !same(this.#state, state)) return false;
    // Last: encoding a canvas costs the most of these checks.
    return this.#pixels.every(({ canvas, url }) => canvasDataUrl(canvas) === url);
  }

  stop(): void {
    this.#observer.disconnect();
    for (const target of this.#targets) {
      for (const type of LOAD_EVENTS) target.removeEventListener(type, this.#mark, true);
    }
    for (const d of this.#docs) d.fonts?.removeEventListener("loadingdone", this.#mark);
  }
}
