import type { ShadowWatch } from "../render/live";
import { RuleIndex } from "./sheets";

/**
 * One media feature test (the contents of innermost parentheses): `(name)`, `(name: value)` or a
 * range such as `(resolution >= 2dppx)` or `(1dppx < resolution <= 2dppx)`.
 */
const FEATURE_TEST = /\(([^()]*)\)/g;
/** Media query text that may test a pinned feature. */
const MENTIONS_PINNED = /prefers-|color|resolution|device-|pointer|hover|dynamic-range|display-mode|monochrome/i;
/** Media conditions that never and always hold, valid wherever a media feature is. */
const NEVER = "(width < 0px)";
const ALWAYS = "(width >= 0px)";

/** Device pixels per CSS px of the export: the video has one pixel per CSS px, as `--scale 1`. */
const RESOLUTION = 1;
/** Bits per colour component of the CLI's screen (`--force-color-profile=srgb`). */
const COLOR_BITS = 8;
/** CSS px per `em` or `rem` in a media query: the initial font size of the CLI's browser. */
const FONT_SIZE = 16;

/** Color scheme of the export: the CLI's browser emulates dark for theme "dark" and light otherwise. */
export type ColorScheme = "light" | "dark";

/** What the export frame's host-dependent media features answer: those of the CLI's browser context. */
export interface MediaPins {
  /** Color scheme the CLI's browser emulates. */
  scheme: ColorScheme;
  /** Viewport size in CSS px, which the CLI's browser also reports as the screen size. */
  width: number;
  height: number;
}

/**
 * A discrete feature: its value in the CLI's browser context, the answer of a bare `(name)` test
 * there (null when Chromium does not evaluate one) and the other values it can have.
 */
interface Discrete {
  value: string;
  bare: boolean | null;
  others: readonly string[];
}

const POINTER: Discrete = { value: "fine", bare: true, others: ["coarse", "none"] };
const HOVER: Discrete = { value: "hover", bare: true, others: ["none"] };
/**
 * Discrete features other than `prefers-color-scheme`, as headless Chromium with Playwright's
 * defaults and the CLI's flags answers them: no motion, transparency or contrast preference, no
 * forced colours, an sRGB standard-range screen, a mouse and no touch screen, a browser tab.
 */
const DISCRETE: ReadonlyMap<string, Discrete> = new Map([
  ["prefers-reduced-motion", { value: "no-preference", bare: false, others: ["reduce"] }],
  ["prefers-reduced-transparency", { value: "no-preference", bare: false, others: ["reduce"] }],
  ["prefers-contrast", { value: "no-preference", bare: false, others: ["more", "less", "custom"] }],
  ["forced-colors", { value: "none", bare: false, others: ["active"] }],
  ["color-gamut", { value: "srgb", bare: true, others: ["p3", "rec2020"] }],
  ["dynamic-range", { value: "standard", bare: null, others: ["high"] }],
  ["pointer", POINTER],
  ["any-pointer", POINTER],
  ["hover", HOVER],
  ["any-hover", HOVER],
  [
    "display-mode",
    {
      value: "browser",
      bare: true,
      others: [
        "fullscreen",
        "standalone",
        "minimal-ui",
        "window-controls-overlay",
        "picture-in-picture",
        "tabbed",
        "borderless",
      ],
    },
  ],
]);

function discrete(name: string, scheme: ColorScheme): Discrete | undefined {
  if (name !== "prefers-color-scheme") return DISCRETE.get(name);
  // A bare `(prefers-color-scheme)` holds for either scheme, so it is left alone.
  return { value: scheme, bare: null, others: [scheme === "dark" ? "light" : "dark"] };
}

/** A range feature: its value in the CLI's browser context and how a value it is compared with reads. */
interface Range {
  value: number;
  parse(value: string): number | null;
}

const NUMBER = /^\d*\.?\d+(?:e[+-]?\d+)?$/;
const RESOLUTION_UNITS: Readonly<Record<string, number>> = { dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 };
const LENGTH_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  em: FONT_SIZE,
  rem: FONT_SIZE,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};

/** A number with one of `units`, in the unit worth 1, or null when it does not parse. */
function dimension(value: string, units: Readonly<Record<string, number>>): number | null {
  const match = /^(\d*\.?\d+(?:e[+-]?\d+)?)([a-z]+)$/.exec(value);
  const unit = match ? units[match[2]] : undefined;
  return match && unit !== undefined ? Number(match[1]) * unit : null;
}

const number = (value: string): number | null => (NUMBER.test(value) ? Number(value) : null);
const integer = (value: string): number | null => (/^\d+$/.test(value) ? Number(value) : null);
const resolution = (value: string): number | null =>
  value === "infinite" ? Number.POSITIVE_INFINITY : dimension(value, RESOLUTION_UNITS);
const length = (value: string): number | null => (value === "0" ? 0 : dimension(value, LENGTH_UNITS));
function ratio(value: string): number | null {
  const [a, b = "1", ...rest] = value.split("/");
  const x = number(a);
  const y = number(b);
  return rest.length > 0 || x === null || y === null || y === 0 ? null : x / y;
}

/**
 * Range features as the CLI's browser answers them: one device pixel per CSS px, a screen the size of
 * the viewport, 8-bit colour.
 */
function range(name: string, pins: MediaPins): Range | undefined {
  switch (name) {
    case "resolution":
      return { value: RESOLUTION, parse: resolution };
    // `resolution` is standard, `device-pixel-ratio` exists only with the -webkit- prefix.
    case "-webkit-device-pixel-ratio":
      return { value: RESOLUTION, parse: number };
    case "device-width":
      return { value: pins.width, parse: length };
    case "device-height":
      return { value: pins.height, parse: length };
    case "device-aspect-ratio":
      return { value: pins.width / pins.height, parse: ratio };
    case "color":
      return { value: COLOR_BITS, parse: integer };
    case "monochrome":
      return { value: 0, parse: integer };
    default:
      return undefined;
  }
}

function compare(a: number, op: string, b: number): boolean {
  if (op === "<") return a < b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  if (op === ">=") return a >= b;
  return a === b;
}

/** `(name)` or `(name: value)`, `name` with a `min-` or `max-` prefix (after `-webkit-`) for ranges. */
const PLAIN = /^(-webkit-)?(min-|max-)?([a-z-]+)(?:\s*:\s*(\S+))?$/;
/** Range syntax: `(name < value)`, `(value < name)` or `(value < name < value)`. */
const RANGE = /^(?:([^<>=\s]+)\s*(<=|>=|<|>|=)\s*)?([a-z-]+)(?:\s*(<=|>=|<|>|=)\s*([^<>=\s]+))?$/;

/** Answer of one range feature test, or null when it does not parse. */
function rangeTest(
  feature: Range,
  left: string | undefined,
  leftOp: string,
  rightOp: string,
  right: string | undefined,
): boolean | null {
  // A side the test does not have holds; a side whose value does not parse leaves the test alone.
  const side = (value: string | undefined, holds: (v: number) => boolean): boolean | null => {
    if (value === undefined) return true;
    const v = feature.parse(value);
    return v === null ? null : holds(v);
  };
  const lower = side(left, (v) => compare(v, leftOp, feature.value));
  const upper = side(right, (v) => compare(feature.value, rightOp, v));
  return lower === null || upper === null ? null : lower && upper;
}

/** Answer of one feature test in the CLI's browser, or null when it tests no pinned feature. */
function pinnedAnswer(test: string, pins: MediaPins): boolean | null {
  const plain = PLAIN.exec(test);
  if (plain) {
    const [, webkit = "", prefix, base, value] = plain;
    const name = webkit + base;
    const choice = webkit || prefix ? undefined : discrete(name, pins.scheme);
    if (choice) {
      if (value === undefined) return choice.bare;
      if (value === choice.value) return true;
      return choice.others.includes(value) ? false : null;
    }
    const feature = range(name, pins);
    if (!feature) return null;
    if (value === undefined) return prefix ? null : feature.value !== 0;
    const op = prefix === "min-" ? ">=" : prefix === "max-" ? "<=" : "=";
    return rangeTest(feature, undefined, "=", op, value);
  }
  const parts = RANGE.exec(test);
  if (!parts || (parts[2] === undefined && parts[4] === undefined)) return null;
  const [, left, leftOp = "=", name, rightOp = "=", right] = parts;
  const feature = range(name, pins);
  return feature ? rangeTest(feature, left, leftOp, rightOp, right) : null;
}

/**
 * `query` with every test of a pinned feature replaced by its answer in the CLI's browser context
 * (Playwright's defaults in headless Chromium, with `--force-color-profile=srgb`): no motion,
 * transparency or contrast preference, no forced colours, `pins.scheme`, one device pixel per CSS px,
 * an 8-bit sRGB standard-range screen of the viewport's size, a fine pointer that can hover and the
 * `browser` display mode. So `(prefers-reduced-motion: no-preference)`, `(min-resolution: 1dppx)`,
 * `(pointer: fine)` and `(color-gamut: srgb)` always hold, `(prefers-reduced-motion: reduce)`,
 * `(forced-colors: active)`, `(min-resolution: 2dppx)`, `(color-gamut: p3)`, `(hover: none)` and
 * `(display-mode: standalone)` never do, `(prefers-color-scheme: dark)` holds only for scheme dark
 * and `(max-device-width: 480px)` only for a viewport at most 480 px wide. Everything else in the
 * query is left as it is.
 */
export function pinnedQuery(query: string, pins: MediaPins): string {
  if (!MENTIONS_PINNED.test(query)) return query;
  return query.replace(FEATURE_TEST, (test, inner: string) => {
    const normal = inner
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/ ?\/ ?/g, "/");
    const answer = pinnedAnswer(normal, pins);
    return answer === null ? test : answer ? ALWAYS : NEVER;
  });
}

/**
 * Two queries that tell whether the host answers a pinned feature as the CLI's browser does: `hold`
 * holds there (every test of a pinned feature's own value), `fail` does not (any test of another value).
 */
function probes(pins: MediaPins): { hold: string; fail: string } {
  const hold = [
    `(prefers-color-scheme: ${pins.scheme})`,
    `(resolution: ${RESOLUTION}dppx)`,
    `(device-width: ${pins.width}px)`,
    `(device-height: ${pins.height}px)`,
    `(color: ${COLOR_BITS})`,
    "(monochrome: 0)",
  ];
  const fail = [`(prefers-color-scheme: ${pins.scheme === "dark" ? "light" : "dark"})`];
  for (const [name, feature] of DISCRETE) {
    hold.push(`(${name}: ${feature.value})`);
    for (const other of feature.others) fail.push(`(${name}: ${other})`);
  }
  return { hold: hold.join(" and "), fail: fail.join(", ") };
}

function pin(media: MediaList | null | undefined, pins: MediaPins): void {
  const text = media?.mediaText;
  if (!media || !text) return;
  const pinned = pinnedQuery(text, pins);
  if (pinned !== text) media.mediaText = pinned;
}

/**
 * `@import` and `@media` rules (CSSRule.IMPORT_RULE and MEDIA_RULE) at any depth, style rules
 * included (nesting takes `@media`); not in `@page` (6) or `@keyframes` (7).
 */
const MEDIA_RULES = new RuleIndex({
  keep: (type) => type === 3 || type === 4,
  enter: (type) => type !== 6 && type !== 7,
});

/** Pins a sheet's media and that of its rules; the rules are walked again only once they change. */
function pinSheet(sheet: CSSStyleSheet, pins: MediaPins): void {
  pin(sheet.media, pins);
  for (const rule of MEDIA_RULES.rules(sheet)) {
    pin((rule as CSSImportRule | CSSMediaRule).media, pins);
    // Read on every sweep: an imported sheet may load after the walk.
    const imported = rule.type === 3 ? (rule as CSSImportRule).styleSheet : null;
    if (imported) pinSheet(imported, pins);
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
 * Makes the export frame show what the CLI shows. Its browser context answers the media features
 * {@link pinnedQuery} lists as a desktop browser tab with a mouse on an 8-bit sRGB, standard-range
 * screen the size of the viewport, at one device pixel per CSS px, with no motion, transparency or
 * contrast preference, no forced colours and `pins.scheme` (light unless the theme is dark). A frame
 * in the page follows the host instead (the frame element's `color-scheme` does not change what the
 * frame prefers): a reduced-motion, high-contrast or dark system setting, a high-density, wide-gamut
 * or HDR screen, a touch screen, Studio running as an installed app or the screen's size would
 * change pages with `@media (prefers-reduced-motion)`, `@media (forced-colors: active)`,
 * `@media (prefers-color-scheme: dark)`, `@media (min-resolution: 2dppx)`, `@media (color-gamut: p3)`,
 * `@media (pointer: coarse)`, `@media (display-mode: standalone)` or `@media (max-device-width: 480px)`
 * rules, the player's `theme: "auto"`, and adapters that ask.
 * Scripts get a `matchMedia` that answers with the pinned values; while the host differs, the pinned
 * tests of style sheets (the frame, the watched shadow roots and same-origin child frames such as the
 * HTML adapter's capture page, swept once that has loaded) are rewritten to their answers. Forced
 * colours (Windows high contrast) also repaint every element in the host's palette, so while they
 * are on, each of those documents and shadow roots also gets a sheet that opts it out.
 *
 * Not covered: `srcset`, `image-set()` and `<source media>` still pick images for the host; the
 * browser's own colours in child frames that opt into both schemes (`color-scheme: light dark`:
 * default text and background, form controls) follow the host's scheme; with forced colours on,
 * system colour keywords (`Canvas`, `CanvasText`) still give the host's palette; and scripts that
 * read `screen` or `navigator.maxTouchPoints` see the host's.
 */
export function pinMediaFeatures(win: Window & typeof globalThis, shadows: ShadowWatch, pins: MediaPins): MediaPin {
  const original = win.matchMedia;
  const pinned = (query: string): MediaQueryList => original.call(win, pinnedQuery(String(query), pins));
  win.matchMedia = pinned;
  const forced = (): boolean => original.call(win, "(forced-colors: active)").matches;
  const { hold, fail } = probes(pins);
  const hostDiffers = (): boolean => !original.call(win, hold).matches || original.call(win, fail).matches;

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
      for (const sheet of [...Array.from(root.styleSheets), ...root.adoptedStyleSheets]) pinSheet(sheet, pins);
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
