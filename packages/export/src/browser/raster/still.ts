import { animationState, sheetsOf } from "./far";
import { SheetMark, watchSheetEdits } from "./sheet-edits";
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
 * What else the look of a frame depends on, besides its DOM, scroll offsets and rules edited in
 * place ({@link SheetMark}): FontFace faces, the font sets of its documents, focus, the style sheets
 * (whether each applies, and to what media) and Web Animations, read from each document and shadow
 * root. Null while a font loads or an animation runs, as both change the frame on the wall clock.
 * An animation counts by the values it animates ({@link animationState}), not by its time: after
 * going live every frame seeks each animation, those holding their end state included.
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
    const sheets = sheetsOf(target);
    state.push(sheets.length);
    for (const sheet of sheets) state.push(sheet, sheet.disabled, sheet.media?.mediaText);
    const animations = typeof target.getAnimations === "function" ? target.getAnimations() : [];
    state.push(animations.length);
    for (const animation of animations) {
      const look = animationState(animation);
      if (look === null) return null;
      state.push(animation, look);
    }
  }
  return state;
}

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * Tells whether a frame document still shows what a snapshot of it read, without walking it
 * again. Created before the walk, so a change during it counts too. The frame shows the same while:
 * nothing in the document, its shadow roots or the documents of its same-origin frames (see
 * {@link frameDocuments}) mutated; no image, style sheet or font loaded in any of them; no popover
 * or details element toggled; the shadow roots, frame documents, FontFace faces, focus, style
 * sheets and Web Animations (none running) are those of the start, each animation showing the
 * values it showed then, and no rule was edited in place through the CSSOM, which changes it without a
 * mutation ({@link StillWatch.sheets}; the watch wraps the CSSOM of each document's window to tell,
 * see watchSheetEdits); the scroll offsets the walk read have not moved; and each canvas whose
 * pixels went into the image gives the same data URL ({@link settle}). What the walk marks as
 * changing on its own (videos, frames of another origin, shadow roots the source does not list,
 * SMIL) the snapshot reports instead (`FrameSnapshot.settled`). Not watched: form control values,
 * which the render page never changes between frames, and the declarations watchSheetEdits does not
 * see (`@font-face` rules, one taken from a frame without scripts before its window was watched).
 */
export class StillWatch {
  readonly #source: StillSource;
  readonly #docs: readonly Document[];
  readonly #targets: readonly (Document | ShadowRoot)[];
  readonly #roots: readonly ShadowRoot[];
  readonly #frames: readonly Document[];
  readonly #observer: MutationObserver;
  readonly #state: unknown[] | null;
  /** The style sheets at the start, as far as rules edited in place go. */
  readonly sheets: SheetMark;
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
      for (const type of CHANGE_EVENTS) target.addEventListener(type, this.#mark, true);
    }
    for (const d of this.#docs) {
      d.fonts?.addEventListener("loadingdone", this.#mark);
      // Its scripts may have taken declarations from the sheets of its watched shadow roots too.
      watchSheetEdits(d.defaultView, d === doc ? [d, ...this.#roots] : [d]);
    }
    this.#state = stateOf(source, this.#docs, this.#targets);
    this.sheets = new SheetMark(this.#targets.flatMap(sheetsOf));
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
    if (!this.sheets.holds()) return false;
    const state = stateOf(this.#source, this.#docs, this.#targets);
    if (state === null || !same(this.#state, state)) return false;
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
