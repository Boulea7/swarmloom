/**
 * Computed-style diffing for the frame snapshot. The snapshot resets every element with
 * `all: unset` and writes back only what differs: inherited properties when they differ from the
 * parent's value, the others when they differ from what a reset clone computes for them (origins
 * whenever something uses them, {@link ORIGINS}). Native form controls start from the UA's styles
 * instead ({@link nativeControl}). Properties not listed in {@link INHERITED} are treated as not
 * inherited, which is always safe (only more verbose).
 */

/** Properties known to inherit. Only list a property when sure: a wrong entry loses styles. */
export const INHERITED: ReadonlySet<string> = new Set([
  "color",
  "direction",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-variant-caps",
  "font-variant-east-asian",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variant-alternates",
  "font-variant-position",
  "font-variant-emoji",
  "font-feature-settings",
  "font-variation-settings",
  "font-kerning",
  "font-optical-sizing",
  "font-size-adjust",
  "font-synthesis-weight",
  "font-synthesis-style",
  "font-synthesis-small-caps",
  "font-palette",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-align",
  "text-align-last",
  "text-indent",
  "text-transform",
  "text-shadow",
  "text-rendering",
  "text-decoration-skip-ink",
  "text-underline-position",
  "text-underline-offset",
  "text-emphasis-color",
  "text-emphasis-position",
  "text-emphasis-style",
  "text-orientation",
  "text-size-adjust",
  "text-wrap-mode",
  "text-wrap-style",
  "text-autospace",
  "text-spacing-trim",
  "white-space-collapse",
  "word-break",
  "overflow-wrap",
  "line-break",
  "hyphens",
  "hyphenate-character",
  "tab-size",
  "writing-mode",
  "visibility",
  "list-style-image",
  "list-style-position",
  "list-style-type",
  "quotes",
  "orphans",
  "widows",
  "caret-color",
  "accent-color",
  "color-scheme",
  "border-collapse",
  "-webkit-border-horizontal-spacing",
  "-webkit-border-vertical-spacing",
  "caption-side",
  "empty-cells",
  "image-rendering",
  "image-orientation",
  "paint-order",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-rule",
  "shape-rendering",
  "color-interpolation",
  "color-interpolation-filters",
  "text-anchor",
  "dominant-baseline",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
  "-webkit-font-smoothing",
  "-webkit-locale",
  "-webkit-text-security",
  "-webkit-rtl-ordering",
  "print-color-adjust",
  "ruby-position",
  "ruby-align",
  "math-depth",
  "math-style",
  "math-shift",
  "forced-color-adjust",
]);

/** Properties that never matter for a still frame, or that must keep their reset value. */
const SKIP_PREFIXES = [
  "--",
  "animation",
  "transition",
  "scroll-",
  "overscroll-",
  "view-timeline",
  "view-transition",
  "timeline-scope",
  "position-try",
  "anchor-",
  "position-anchor",
  // Logical twins: the physical longhands carry the same computed values.
  "inset-block",
  "inset-inline",
  "margin-block",
  "margin-inline",
  "padding-block",
  "padding-inline",
  "border-block",
  "border-inline",
  "border-start-",
  "border-end-",
  "block-size",
  "inline-size",
  "min-block-size",
  "min-inline-size",
  "max-block-size",
  "max-inline-size",
  "overflow-block",
  "overflow-inline",
  "contain-intrinsic-block-size",
  "contain-intrinsic-inline-size",
];

const SKIP = new Set([
  "cursor",
  "pointer-events",
  "user-select",
  "-webkit-user-select",
  "-webkit-user-drag",
  "-webkit-user-modify",
  "-webkit-tap-highlight-color",
  "touch-action",
  "will-change",
  "content-visibility",
  "interactivity",
  "interpolate-size",
  "speak",
  "app-region",
  // Not reset by `all`; written by hand where needed.
  "unicode-bidi",
]);

/**
 * What gives a box without content its size and place among its siblings, and what it counts
 * (content that shows may show the counters). An empty box away from the viewport needs nothing
 * else: nothing of it shows. Its place in a line or table row takes `vertical-align` (in Firefox a
 * shorthand of the three after it), and a collapsed table row takes no room (`visibility`).
 */
const LAYOUT = new Set([
  "display",
  "position",
  "float",
  "clear",
  "vertical-align",
  "alignment-baseline",
  "baseline-shift",
  "baseline-source",
  "visibility",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  ...["top", "right", "bottom", "left"].flatMap((side) => [
    `margin-${side}`,
    `padding-${side}`,
    `border-${side}-width`,
    `border-${side}-style`,
  ]),
  "overflow-x",
  "overflow-y",
  "contain",
  "container-type",
  "scrollbar-gutter",
  "zoom",
  "writing-mode",
  "direction",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "align-self",
  "justify-self",
  "grid-row-start",
  "grid-row-end",
  "grid-column-start",
  "grid-column-end",
  "column-span",
  "break-before",
  "break-after",
  "counter-increment",
  "counter-reset",
  "counter-set",
]);

/**
 * Of {@link LAYOUT}, what does not apply to table rows and cells: margins, floats, breaks and
 * placement as a flex or grid item.
 */
const NOT_IN_TABLES = new Set([
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "float",
  "clear",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "align-self",
  "justify-self",
  "grid-row-start",
  "grid-row-end",
  "grid-column-start",
  "grid-column-end",
  "column-span",
  "break-before",
  "break-after",
]);

/**
 * Inherited properties whose initial value is `currentcolor`. The keyword itself is inherited, so
 * text the snapshot never writes (a placeholder in the UA's grey) follows its own colour; a resolved
 * value written on a clone would pin every such descendant to it.
 */
const CURRENT_COLOR_INHERITED = new Set([
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "text-emphasis-color",
]);
const CURRENT_COLOR = "currentcolor";

/**
 * Origins, by the properties they act on. Each resolves against the element's own box, so the empty
 * inline probe reads `0px 0px` for it while a reset clone starts at the centre: compared with the
 * probe, an origin at the top left corner (OFD and EPUB layers, the stage's world, any SVG child)
 * would be left out and the clone would turn and scale about its centre. An origin is written
 * whenever one of its properties applies, and never otherwise (it then changes nothing).
 */
const ORIGINS: ReadonlyMap<string, readonly string[]> = new Map([
  ["transform-origin", ["transform", "rotate", "scale", "offset-path"]],
  ["perspective-origin", ["perspective"]],
]);

const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** Input types drawn as native controls; a type not listed reads as "text" or draws nothing. */
const CONTROL_INPUTS = [
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "color",
  "range",
  "checkbox",
  "radio",
  "file",
  "submit",
  "reset",
  "button",
];
/** Kinds of native form controls (see {@link controlKind}). */
const CONTROLS = [
  ...CONTROL_INPUTS.map((type) => `input:${type}`),
  "button",
  "select",
  "select:listbox",
  "textarea",
  "progress",
  "meter",
];
const SCHEMES = ["light", "dark"] as const;
/** Properties whose UA value tells the light scheme from the dark one. */
const SCHEME_LOOK = [
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
];

function skipped(name: string): boolean {
  if (SKIP.has(name)) return true;
  return SKIP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Colour of the probe {@link readBaseline} reads. Properties that compute to it start at
 * `currentcolor`, so a reset clone starts them at its own colour, not at the probe's.
 */
const PROBE_COLOR = "rgb(1, 2, 3)";

/** Property names and their `all: unset` values for one document. */
export interface StyleBaseline {
  /** Longhands to compare, in a stable order. */
  readonly props: readonly string[];
  /** Of those, the ones an empty box away from the viewport needs ({@link LAYOUT}). */
  readonly layout: readonly string[];
  /** Of those, the ones that apply to table rows and cells. */
  readonly tableLayout: readonly string[];
  /** Initial value (as computed on a reset probe) per property. */
  readonly initial: ReadonlyMap<string, string>;
  /** Non-inherited properties whose initial value is `currentcolor` (border, outline, rule colours). */
  readonly currentColor: ReadonlySet<string>;
  /**
   * Widths that compute to 0 while their style is `none` or `hidden` (borders, column rules), by
   * that style property. A reset clone has no style, so its width is the initial `medium`.
   */
  readonly widthStyle: ReadonlyMap<string, string>;
  /** UA values of each native form control kind, by `"<kind> <scheme>"` (see {@link nativeControl}). */
  readonly controls: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * Reads the property list and initial values in `doc`: a probe element styled `all: unset` gives
 * the computed value every reset clone starts from.
 */
export function readBaseline(doc: Document): StyleBaseline {
  const win = doc.defaultView;
  if (!win) throw new Error("The frame document has no window");
  const probe = doc.createElement("div");
  probe.setAttribute("style", `all:unset;color:${PROBE_COLOR}`);
  (doc.body ?? doc.documentElement).append(probe);
  try {
    const cs = win.getComputedStyle(probe);
    const props: string[] = [];
    const initial = new Map<string, string>();
    const currentColor = new Set<string>();
    for (let i = 0; i < cs.length; i++) {
      const name = cs.item(i);
      if (!name || skipped(name)) continue;
      props.push(name);
      const value = cs.getPropertyValue(name);
      initial.set(name, value);
      if (value === PROBE_COLOR && !INHERITED.has(name)) currentColor.add(name);
    }
    props.sort();
    const widthStyle = new Map<string, string>();
    for (const name of props) {
      const style = name.endsWith("-width") ? `${name.slice(0, -"width".length)}style` : null;
      if (style && initial.has(style)) widthStyle.set(name, style);
    }
    const layout = props.filter((name) => LAYOUT.has(name));
    const tableLayout = layout.filter((name) => !NOT_IN_TABLES.has(name));
    return { props, layout, tableLayout, initial, currentColor, widthStyle, controls: readControls(doc, win, props) };
  } finally {
    probe.remove();
  }
}

/**
 * Reads the UA values of every native form control kind in both colour schemes: probes styled
 * `all: revert` (no author style reaches them), out of the layout. Their own colour is read too.
 */
function readControls(doc: Document, win: Window, props: readonly string[]): Map<string, Map<string, string>> {
  const box = doc.createElement("div");
  box.setAttribute("style", "display:none");
  const probes: [string, Element][] = [];
  for (const scheme of SCHEMES) {
    for (const kind of CONTROLS) {
      const [tag = "", type] = kind.split(":");
      const probe = doc.createElement(tag);
      if (tag === "input" && type) probe.setAttribute("type", type);
      if (type === "listbox") probe.setAttribute("multiple", "");
      probe.setAttribute("style", `all:revert;color-scheme:${scheme}`);
      box.append(probe);
      probes.push([`${kind} ${scheme}`, probe]);
    }
  }
  (doc.body ?? doc.documentElement).append(box);
  try {
    const controls = new Map<string, Map<string, string>>();
    for (const [key, probe] of probes) {
      const cs = win.getComputedStyle(probe);
      const values = new Map<string, string>();
      for (const name of props)
        if (!INHERITED.has(name) || name === "color") values.set(name, cs.getPropertyValue(name));
      controls.set(key, values);
    }
    return controls;
  } finally {
    box.remove();
  }
}

/** Kind of native form control `el` is (a key part of {@link StyleBaseline.controls}), or null. */
function controlKind(el: Element): string | null {
  if (el.namespaceURI !== XHTML_NS) return null;
  switch (el.localName) {
    case "input":
      return `input:${(el as HTMLInputElement).type}`;
    case "select": {
      const select = el as HTMLSelectElement;
      return select.multiple || select.size > 1 ? "select:listbox" : "select";
    }
    case "button":
    case "textarea":
    case "progress":
    case "meter":
      return el.localName;
    default:
      return null;
  }
}

/** Whether a clone reverted to the UA's styles shows `value` of the non-inherited `name`. */
function sameAsUa(
  baseline: StyleBaseline,
  cs: CSSStyleDeclaration,
  ua: ReadonlyMap<string, string>,
  name: string,
  value: string,
): boolean {
  const initial = ua.get(name);
  if (value === initial) return true;
  // Both follow their own colour (an unset border colour, say).
  return baseline.currentColor.has(name) && value === cs.getPropertyValue("color") && initial === ua.get("color");
}

/** A form control the browser draws natively, as {@link nativeControl} finds it. */
export interface NativeControl {
  /** UA values of its kind, for {@link styleText}. */
  ua: ReadonlyMap<string, string>;
  /** The colour scheme its UA look was drawn in, when its border and background tell. */
  scheme: (typeof SCHEMES)[number] | null;
}

/**
 * The UA values of a native form control, or null for any other element. The clone of a control
 * starts from the UA's styles (`all: revert`) and is given only what differs from them: Chromium
 * turns a control's native look off once author styles give it any border or background, and a
 * clone given the UA's own values as author styles would lose it. A control the page styled that
 * way gets those values written, and loses its native look on the clone as on the page.
 */
export function nativeControl(baseline: StyleBaseline, el: Element, cs: CSSStyleDeclaration): NativeControl | null {
  const kind = controlKind(el);
  if (!kind || cs.getPropertyValue("appearance") === "none") return null;
  const looks = (scheme: string) => {
    const ua = baseline.controls.get(`${kind} ${scheme}`);
    return ua && SCHEME_LOOK.every((name) => sameAsUa(baseline, cs, ua, name, cs.getPropertyValue(name))) ? ua : null;
  };
  const [light, dark] = SCHEMES.map(looks);
  if (light && !dark) return { ua: light, scheme: "light" };
  if (dark && !light) return { ua: dark, scheme: "dark" };
  const ua = light ?? baseline.controls.get(`${kind} light`);
  return ua ? { ua, scheme: null } : null;
}

/** Inherited property values of one element, for comparing its children against. */
export type InheritedValues = ReadonlyMap<string, string>;

/**
 * Whether a reset clone already shows `value` of `name` without a declaration: it inherits it from
 * the parent's clone, or computes it from the clone's own colour or reset style (or from the UA's
 * styles, `ua`, for a native control). An origin counts as shown when nothing uses it ({@link ORIGINS}).
 */
function unchanged(
  baseline: StyleBaseline,
  cs: CSSStyleDeclaration,
  name: string,
  value: string,
  parent: InheritedValues | null,
  ua: ReadonlyMap<string, string> | undefined,
): boolean {
  // A root clone inherits from the snapshot's wrapper, not from the document it was read from.
  if (INHERITED.has(name)) return parent !== null && parent.get(name) === value;
  const users = ORIGINS.get(name);
  // An engine without one of them reads "" for it.
  if (users) return users.every((user) => ["", "none"].includes(cs.getPropertyValue(user)));
  if (ua) return sameAsUa(baseline, cs, ua, name, value);
  if (baseline.currentColor.has(name)) return value === cs.getPropertyValue("color");
  const style = baseline.widthStyle.get(name);
  if (style !== undefined) {
    // Without a visible style the width draws nothing; with one it goes along with the style.
    const shown = cs.getPropertyValue(style);
    return shown === "none" || shown === "hidden";
  }
  return value === baseline.initial.get(name);
}

/**
 * Declarations of `cs` that a reset clone needs: inherited properties that differ from the
 * parent's value (all of them for a root, `parent` null), other properties that differ from what
 * the clone computes for them. `override` replaces or adds values (scroll offsets, forced overflow).
 * Only `props` are read: all of them, or {@link StyleBaseline.layout} for an empty box. A native
 * control (`ua`, see {@link nativeControl}) starts from the UA's styles instead, and is given every
 * inherited property and the others that differ from the UA's.
 *
 * @returns The declarations and this element's inherited values among `props`, for its children
 *   (`currentcolor` where a clone keeps that keyword).
 */
export function styleText(
  baseline: StyleBaseline,
  cs: CSSStyleDeclaration,
  parent: InheritedValues | null,
  override?: Readonly<Record<string, string>>,
  props: readonly string[] = baseline.props,
  ua?: ReadonlyMap<string, string>,
): { text: string; inherited: Map<string, string> } {
  const out: string[] = ua ? ["all:revert"] : [];
  const inherited = new Map<string, string>();
  const from = ua ? null : parent;
  const color = cs.getPropertyValue("color");
  for (const name of props) {
    const value = cs.getPropertyValue(name);
    const follows =
      CURRENT_COLOR_INHERITED.has(name) && value === color && (from === null || from.get(name) === CURRENT_COLOR);
    if (INHERITED.has(name)) inherited.set(name, follows ? CURRENT_COLOR : value);
    if (override && name in override) continue;
    if (follows) {
      // A root clone sits in other markup, which may have given it another value.
      if (from === null) out.push(`${name}:${CURRENT_COLOR}`);
    } else if (!unchanged(baseline, cs, name, value, from, ua)) {
      out.push(`${name}:${value}`);
    }
  }
  const bidi = cs.getPropertyValue("unicode-bidi");
  if (bidi && bidi !== "normal") out.push(`unicode-bidi:${bidi}`);
  if (override) for (const [name, value] of Object.entries(override)) out.push(`${name}:${value}`);
  return { text: out.join(";"), inherited };
}
