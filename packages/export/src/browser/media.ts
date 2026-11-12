import type { ShadowWatch } from "../render/live";

/**
 * One media feature test (the contents of innermost parentheses): `(name)`, `(name: value)` or a
 * range such as `(resolution >= 2dppx)` or `(1dppx < resolution <= 2dppx)`.
 */
const FEATURE_TEST = /\(([^()]*)\)/g;
/** Media query text that may test a pinned feature. */
const MENTIONS_PINNED =
  /prefers-reduced-motion|prefers-color-scheme|forced-colors|prefers-contrast|resolution|device-pixel-ratio/i;
/** Media conditions that never and always hold, valid wherever a media feature is. */
const NEVER = "(width < 0px)";
const ALWAYS = "(width >= 0px)";

/** Device pixels per CSS px of the export: the video has one pixel per CSS px, as `--scale 1`. */
const RESOLUTION = 1;
/**
 * Discrete features whose value in the CLI's browser context is the "no preference" one (Playwright's
 * defaults): a bare test of these is false there, as is a test of any other value they can have.
 */
const NEUTRAL: ReadonlyMap<string, { neutral: string; others: readonly string[] }> = new Map([
  ["prefers-reduced-motion", { neutral: "no-preference", others: ["reduce"] }],
  ["forced-colors", { neutral: "none", others: ["active"] }],
  ["prefers-contrast", { neutral: "no-preference", others: ["more", "less", "custom"] }],
]);
const DISCRETE = /^([a-z-]+)(?:\s*:\s*([a-z-]+))?$/;
const SCHEME = /^prefers-color-scheme(?:\s*:\s*([a-z-]+))?$/;

/** Color scheme of the export: the CLI's browser emulates dark for theme "dark" and light otherwise. */
export type ColorScheme = "light" | "dark";
/** `resolution` (in `dppx`, `x`, `dpi`, `dpcm`) and `-webkit-device-pixel-ratio` (a bare number). */
const RESOLUTION_FEATURE = /^(-webkit-)?(min-|max-)?(resolution|device-pixel-ratio)(?:\s*:\s*(\S+))?$/;
const RANGE = /^(?:(\S+)\s*(<=|>=|<|>|=)\s*)?(resolution|-webkit-device-pixel-ratio)(?:\s*(<=|>=|<|>|=)\s*(\S+))?$/;
const UNITS: Readonly<Record<string, number>> = { dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 };

/** A resolution value in dppx (a bare number for `device-pixel-ratio`), or null when it does not parse. */
function dppx(value: string, feature: string): number | null {
  if (feature !== "resolution") return /^\d*\.?\d+$/.test(value) ? Number(value) : null;
  if (value === "infinite") return Number.POSITIVE_INFINITY;
  const match = /^(\d*\.?\d+(?:e[+-]?\d+)?)(dppx|x|dpi|dpcm)$/.exec(value);
  return match ? Number(match[1]) * (UNITS[match[2]] ?? 1) : null;
}

function compare(a: number, op: string, b: number): boolean {
  if (op === "<") return a < b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  if (op === ">=") return a >= b;
  return a === b;
}

/** Answer of one resolution test at {@link RESOLUTION}, or null when it is not one or does not parse. */
function resolutionTest(test: string): boolean | null {
  const plain = RESOLUTION_FEATURE.exec(test);
  if (plain) {
    const [, webkit, prefix, feature, value] = plain;
    // `resolution` is standard, `device-pixel-ratio` exists only with the -webkit- prefix.
    if ((feature === "resolution") === Boolean(webkit)) return null;
    if (value === undefined) return prefix ? null : true;
    const v = dppx(value, feature);
    if (v === null) return null;
    return compare(RESOLUTION, prefix === "min-" ? ">=" : prefix === "max-" ? "<=" : "=", v);
  }
  const range = RANGE.exec(test);
  if (!range || (range[2] === undefined && range[4] === undefined)) return null;
  const [, left, leftOp = "=", name, rightOp = "=", right] = range;
  const feature = name === "resolution" ? name : "device-pixel-ratio";
  // A side the test does not have holds; a side whose value does not parse leaves the test alone.
  const side = (value: string | undefined, holds: (v: number) => boolean): boolean | null => {
    if (value === undefined) return true;
    const v = dppx(value, feature);
    return v === null ? null : holds(v);
  };
  const lower = side(left, (v) => compare(v, leftOp, RESOLUTION));
  const upper = side(right, (v) => compare(RESOLUTION, rightOp, v));
  return lower === null || upper === null ? null : lower && upper;
}

/** Answer of one feature test in the CLI's browser, or null when it tests no pinned feature. */
function pinnedAnswer(test: string, scheme: ColorScheme): boolean | null {
  const discrete = DISCRETE.exec(test);
  const feature = discrete ? NEUTRAL.get(discrete[1]) : undefined;
  if (discrete && feature) {
    const value = discrete[2];
    if (value === undefined || feature.others.includes(value)) return false;
    return value === feature.neutral ? true : null;
  }
  const colors = SCHEME.exec(test);
  // A bare `(prefers-color-scheme)` holds for either scheme, so it is left alone.
  if (colors) return colors[1] === "light" || colors[1] === "dark" ? colors[1] === scheme : null;
  return resolutionTest(test);
}

/**
 * `query` with every test of a pinned feature replaced by its answer in the CLI's browser context,
 * which emulates `prefers-reduced-motion: no-preference`, `forced-colors: none`,
 * `prefers-contrast: no-preference` and the export's color scheme, and renders at one device pixel
 * per CSS px: `(prefers-reduced-motion: no-preference)` and `(min-resolution: 1dppx)` always hold,
 * `(prefers-reduced-motion: reduce)`, `(forced-colors: active)`, `(prefers-contrast: more)` and
 * `(min-resolution: 2dppx)` never do, `(prefers-color-scheme: dark)` holds only for `scheme` dark.
 * Everything else in the query is left as it is.
 */
export function pinnedQuery(query: string, scheme: ColorScheme = "light"): string {
  if (!MENTIONS_PINNED.test(query)) return query;
  return query.replace(FEATURE_TEST, (test, inner: string) => {
    const answer = pinnedAnswer(inner.trim().toLowerCase().replace(/\s+/g, " "), scheme);
    return answer === null ? test : answer ? ALWAYS : NEVER;
  });
}

function pin(media: MediaList | null | undefined, scheme: ColorScheme): void {
  const text = media?.mediaText;
  if (!media || !text) return;
  const pinned = pinnedQuery(text, scheme);
  if (pinned !== text) media.mediaText = pinned;
}

function pinSheet(sheet: CSSStyleSheet, scheme: ColorScheme): void {
  pin(sheet.media, scheme);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return; // Cross-origin sheets keep their rules private.
  }
  pinRules(rules, scheme);
}

function pinRules(rules: CSSRuleList, scheme: ColorScheme): void {
  for (const rule of Array.from(rules)) {
    // CSSRule.IMPORT_RULE and MEDIA_RULE; constructor checks would fail across windows.
    if (rule.type === 3) {
      pin((rule as CSSImportRule).media, scheme);
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) pinSheet(imported, scheme);
    } else if (rule.type === 4) {
      pin((rule as CSSMediaRule).media, scheme);
    }
    if ("cssRules" in rule) pinRules((rule as CSSGroupingRule).cssRules, scheme);
  }
}

/**
 * Opts a document or shadow tree out of the host's forced colours: every element keeps its authored
 * colours. Each tree needs its own, since a shadow host's `all: initial !important` (the stage's)
 * beats an outer tree's rule and would turn forced colours back on inside.
 */
const UNFORCED = ":host,*{forced-color-adjust:none!important}";

/** Pins the export frame's host-dependent media features to the CLI's values. */
export interface MediaPin {
  /** Rewrites the pinned tests of every style sheet the frame has now; run before each capture. */
  sweep(): void;
  /** Restores `matchMedia` and stops watching for frames. */
  stop(): void;
}

/**
 * Makes the export frame show what the CLI shows. Its browser context emulates
 * `prefers-reduced-motion: no-preference`, `forced-colors: none`, `prefers-contrast: no-preference`
 * and `scheme` (light unless the theme is dark) and renders at one device pixel per CSS px, while a
 * frame in the page follows the host (the frame element's `color-scheme` does not change what the
 * frame prefers): a reduced-motion, high-contrast or dark system setting or a high-density screen
 * would change pages with `@media (prefers-reduced-motion)`, `@media (forced-colors: active)`,
 * `@media (prefers-contrast: more)`, `@media (prefers-color-scheme: dark)` or
 * `@media (min-resolution: 2dppx)` rules, the player's `theme: "auto"`, and adapters that ask.
 * Scripts get a `matchMedia` that answers with the pinned values; while the host differs, the pinned
 * tests of style sheets (the frame, the watched shadow roots and same-origin child frames such as the
 * HTML adapter's capture page, swept once that has loaded) are rewritten to their answers. Forced
 * colours (Windows high contrast) also repaint every element in the host's palette, so while they
 * are on, each of those documents and shadow roots also gets a sheet that opts it out.
 *
 * Not covered: `srcset` and `image-set()` still pick images for the host's pixel density; the
 * browser's own colours in child frames that opt into both schemes (`color-scheme: light dark`:
 * default text and background, form controls) follow the host's scheme; and with forced colours on,
 * system colour keywords (`Canvas`, `CanvasText`) still give the host's palette.
 */
export function pinMediaFeatures(win: Window & typeof globalThis, shadows: ShadowWatch, scheme: ColorScheme): MediaPin {
  const original = win.matchMedia;
  const pinned = (query: string): MediaQueryList => original.call(win, pinnedQuery(String(query), scheme));
  win.matchMedia = pinned;
  const forced = (): boolean => original.call(win, "(forced-colors: active)").matches;
  const hostDiffers = (): boolean =>
    original.call(win, "(prefers-reduced-motion: reduce), (prefers-contrast)").matches ||
    forced() ||
    original.call(win, "(prefers-color-scheme: dark)").matches !== (scheme === "dark") ||
    !original.call(win, `(resolution: ${RESOLUTION}dppx)`).matches;

  const unforced = new WeakMap<Document, CSSStyleSheet>();
  const unforce = (root: Document | ShadowRoot): void => {
    const doc = root.nodeType === 9 ? (root as Document) : (root as ShadowRoot).ownerDocument;
    let sheet = unforced.get(doc);
    if (!sheet) {
      const view = doc.defaultView as (Window & typeof globalThis) | null;
      if (!view) return;
      // Built in the document's own window: a sheet can only be adopted within the document it was made for.
      sheet = new view.CSSStyleSheet();
      sheet.replaceSync(UNFORCED);
      unforced.set(doc, sheet);
    }
    // Kept last on every sweep, as a tree may replace or add adopted sheets: at equal specificity,
    // the later sheet wins.
    const adopted = root.adoptedStyleSheets;
    if (adopted[adopted.length - 1] !== sheet) root.adoptedStyleSheets = [...adopted.filter((s) => s !== sheet), sheet];
  };

  const sweep = (): void => {
    if (!hostDiffers()) return;
    const unforcing = forced();
    const roots: (Document | ShadowRoot)[] = [win.document, ...shadows.roots()];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (unforcing) unforce(root);
      for (const sheet of [...Array.from(root.styleSheets), ...root.adoptedStyleSheets]) pinSheet(sheet, scheme);
      for (const frame of Array.from(root.querySelectorAll("iframe"))) {
        if (frame.contentDocument) roots.push(frame.contentDocument);
      }
    }
  };
  // Adapters lay pages out in child frames during init(); their styles must be pinned before the capture.
  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === 1 && (node as Element).localName === "iframe") node.addEventListener("load", sweep);
      }
    }
    sweep();
  });
  observer.observe(win.document, { childList: true, subtree: true });

  return {
    sweep,
    stop() {
      observer.disconnect();
      if (win.matchMedia === pinned) win.matchMedia = original;
    },
  };
}
