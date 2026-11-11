/**
 * Computed-style diffing for the frame snapshot. The snapshot resets every element with
 * `all: unset` and writes back only what differs: inherited properties when they differ from the
 * parent's value, the others when they differ from their initial value. Properties not listed in
 * {@link INHERITED} are treated as not inherited, which is always safe (only more verbose).
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

function skipped(name: string): boolean {
  if (SKIP.has(name)) return true;
  return SKIP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Property names and their `all: unset` values for one document. */
export interface StyleBaseline {
  /** Longhands to compare, in a stable order. */
  readonly props: readonly string[];
  /** Initial value (as computed on a reset probe) per property. */
  readonly initial: ReadonlyMap<string, string>;
}

/**
 * Reads the property list and initial values in `doc`: a probe element styled `all: unset` gives
 * the computed value every reset clone starts from.
 */
export function readBaseline(doc: Document): StyleBaseline {
  const win = doc.defaultView;
  if (!win) throw new Error("The frame document has no window");
  const probe = doc.createElement("div");
  probe.setAttribute("style", "all:unset");
  (doc.body ?? doc.documentElement).append(probe);
  try {
    const cs = win.getComputedStyle(probe);
    const props: string[] = [];
    const initial = new Map<string, string>();
    for (let i = 0; i < cs.length; i++) {
      const name = cs.item(i);
      if (!name || skipped(name)) continue;
      props.push(name);
      initial.set(name, cs.getPropertyValue(name));
    }
    props.sort();
    return { props, initial };
  } finally {
    probe.remove();
  }
}

/** Inherited property values of one element, for comparing its children against. */
export type InheritedValues = ReadonlyMap<string, string>;

/**
 * Declarations of `cs` that a reset clone needs: inherited properties that differ from the
 * parent's value (all of them for a root, `parent` null), other properties that differ from the
 * initial value. `override` replaces or adds values (scroll offsets, forced overflow).
 *
 * @returns The declarations and this element's inherited values, for its children.
 */
export function styleText(
  baseline: StyleBaseline,
  cs: CSSStyleDeclaration,
  parent: InheritedValues | null,
  override?: Readonly<Record<string, string>>,
): { text: string; inherited: Map<string, string> } {
  const out: string[] = [];
  const inherited = new Map<string, string>();
  for (const name of baseline.props) {
    const value = cs.getPropertyValue(name);
    const isInherited = INHERITED.has(name);
    if (isInherited) inherited.set(name, value);
    if (override && name in override) continue;
    const reference = isInherited && parent ? parent.get(name) : baseline.initial.get(name);
    if (value !== reference) out.push(`${name}:${value}`);
  }
  const bidi = cs.getPropertyValue("unicode-bidi");
  if (bidi && bidi !== "normal") out.push(`unicode-bidi:${bidi}`);
  if (override) for (const [name, value] of Object.entries(override)) out.push(`${name}:${value}`);
  return { text: out.join(";"), inherited };
}
