/**
 * Viewport classes the layout reacts to, kept in one place:
 *  - watch: a watch-sized screen, at most 320 x 400 CSS px. The window alone is not enough: a
 *    narrow window on a phone or desktop screen (split screen, side panel) is no watch;
 *  - compact: phones, where panels become bottom sheets;
 *  - dual: a foldable whose viewport is split by a hinge (Viewport Segments), "columns" when the
 *    segments sit side by side, "rows" when they are stacked;
 *  - posture: Device Posture API ("folded" or "continuous"), as a progressive enhancement only.
 *
 * Everything degrades to plain responsive CSS where the APIs do not exist (Firefox, Safari).
 * `@media (shape: round)` is deliberately not used: no browser implements it; `?round=1` forces
 * the inscribed layout instead.
 */

export type DualLayout = "none" | "columns" | "rows";

export interface ViewportState {
  watch: boolean;
  compact: boolean;
  dual: DualLayout;
  posture: "folded" | "continuous" | "unknown";
}

export interface Viewport {
  readonly state: ViewportState;
  /** Calls `fn` after any class changes. Returns an unsubscribe function. */
  onChange(fn: (state: ViewportState) => void): () => void;
  destroy(): void;
}

export const WATCH_QUERY = "(max-width: 320px) and (max-height: 400px)";
/** Largest screen still taken for a watch, in CSS px, short and long side. */
const WATCH_SCREEN = { short: 320, long: 400 } as const;
export const COMPACT_QUERY = "(max-width: 719px)";
const COLUMNS_QUERY = "(horizontal-viewport-segments: 2)";
const ROWS_QUERY = "(vertical-viewport-segments: 2)";

interface PostureLike extends EventTarget {
  readonly type: string;
}

/** True when the device screen itself is watch-sized (unknown sizes are not). */
function watchScreen(win: Window): boolean {
  const width = win.screen?.width ?? 0;
  const height = win.screen?.height ?? 0;
  if (width <= 0 || height <= 0) return false;
  return Math.min(width, height) <= WATCH_SCREEN.short && Math.max(width, height) <= WATCH_SCREEN.long;
}

function postureOf(win: Window): PostureLike | null {
  const posture = (win.navigator as Navigator & { devicePosture?: PostureLike }).devicePosture;
  return posture && typeof posture.type === "string" ? posture : null;
}

/**
 * Tracks the viewport classes and mirrors them onto `root` as data attributes
 * (`data-compact`, `data-dual`, `data-posture`, `data-watch-size`) for CSS.
 */
export function watchViewport(win: Window, root: HTMLElement): Viewport {
  const media = (query: string): MediaQueryList | null =>
    typeof win.matchMedia === "function" ? win.matchMedia(query) : null;
  const watch = media(WATCH_QUERY);
  const compact = media(COMPACT_QUERY);
  const columns = media(COLUMNS_QUERY);
  const rows = media(ROWS_QUERY);
  const posture = postureOf(win);
  const listeners = new Set<(state: ViewportState) => void>();

  const read = (): ViewportState => ({
    watch: (watch?.matches ?? false) && watchScreen(win),
    compact: compact?.matches ?? false,
    dual: columns?.matches ? "columns" : rows?.matches ? "rows" : "none",
    posture: posture ? (posture.type === "folded" ? "folded" : "continuous") : "unknown",
  });

  let state = read();
  const mirror = () => {
    root.dataset.compact = String(state.compact);
    root.dataset.dual = state.dual;
    root.dataset.posture = state.posture;
    root.dataset.watchSize = String(state.watch);
  };
  const update = () => {
    const next = read();
    const changed = (Object.keys(next) as (keyof ViewportState)[]).some((key) => next[key] !== state[key]);
    state = next;
    if (!changed) return;
    mirror();
    for (const fn of listeners) fn(state);
  };
  mirror();

  const queries = [watch, compact, columns, rows].filter((q): q is MediaQueryList => q !== null);
  for (const q of queries) q.addEventListener("change", update);
  posture?.addEventListener("change", update);

  return {
    get state() {
      return state;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      for (const q of queries) q.removeEventListener("change", update);
      posture?.removeEventListener("change", update);
      listeners.clear();
    },
  };
}
