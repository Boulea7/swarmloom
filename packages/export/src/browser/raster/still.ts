import type { ScrollMark, SnapshotSource } from "./snapshot";

/** What a {@link StillWatch} reads: the frame document, its watched shadow roots and FontFace faces. */
export type StillSource = Pick<SnapshotSource, "document" | "shadowRoots" | "faces">;

/** Resource loads that can change a frame without a mutation (images, style sheets, frames). */
const LOAD_EVENTS = ["load", "error"] as const;

/**
 * What else the look of a frame depends on, besides its DOM and scroll offsets: FontFace faces,
 * focus, adopted style sheets and Web Animations, read from the document and each shadow root.
 * Null while a font loads or an animation runs, as both change the frame on the wall clock.
 */
function stateOf(source: StillSource, targets: readonly (Document | ShadowRoot)[]): unknown[] | null {
  const fonts = source.document.fonts;
  if (fonts?.status === "loading") return null;
  const state: unknown[] = [source.faces().length, fonts?.size];
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
 * nothing in the document or its shadow roots mutated; no image, style sheet or font loaded; the
 * shadow roots, FontFace faces, focus, adopted style sheets and Web Animations (none running) are
 * those of the start; and the scroll offsets the walk read ({@link settle}) have not moved.
 * What the walk marks as changing on its own (canvas and video pixels, frames, SMIL) the
 * snapshot reports instead (`FrameSnapshot.settled`). Not watched: form control values
 * and rules edited inside a style sheet through the CSSOM, which the render page never changes
 * between frames.
 */
export class StillWatch {
  readonly #source: StillSource;
  readonly #targets: readonly (Document | ShadowRoot)[];
  readonly #roots: readonly ShadowRoot[];
  readonly #observer: MutationObserver;
  readonly #state: unknown[] | null;
  #scrolls: readonly ScrollMark[] | null = null;
  #changed = false;
  readonly #mark = (): void => {
    this.#changed = true;
  };

  constructor(source: StillSource) {
    this.#source = source;
    const doc = source.document;
    this.#roots = Array.from(source.shadowRoots());
    this.#targets = [doc, ...this.#roots];
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    this.#observer = new (win?.MutationObserver ?? MutationObserver)(this.#mark);
    for (const target of this.#targets) {
      this.#observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
      for (const type of LOAD_EVENTS) target.addEventListener(type, this.#mark, true);
    }
    doc.fonts?.addEventListener("loadingdone", this.#mark);
    this.#state = stateOf(source, this.#targets);
  }

  /** The scroll offsets the snapshot read; until this is called the frame never counts as still. */
  settle(scrolls: readonly ScrollMark[]): void {
    this.#scrolls = scrolls;
  }

  /** Whether the document still shows what the snapshot read. */
  still(): boolean {
    if (this.#changed || !this.#scrolls || !this.#state) return false;
    if (this.#observer.takeRecords().length > 0) {
      this.#changed = true;
      return false;
    }
    if (!same(this.#roots, Array.from(this.#source.shadowRoots()))) return false;
    for (const { el, left, top } of this.#scrolls) {
      if (el.scrollLeft !== left || el.scrollTop !== top) return false;
    }
    const state = stateOf(this.#source, this.#targets);
    return state !== null && same(this.#state, state);
  }

  stop(): void {
    this.#observer.disconnect();
    for (const target of this.#targets) {
      for (const type of LOAD_EVENTS) target.removeEventListener(type, this.#mark, true);
    }
    this.#source.document.fonts?.removeEventListener("loadingdone", this.#mark);
  }
}
