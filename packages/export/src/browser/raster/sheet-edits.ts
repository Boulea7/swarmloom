/**
 * Edits made to style sheets in place through the CSSOM, which change a frame without a DOM
 * mutation: a rule inserted or deleted, a sheet replaced, a new selector, media or key, or a
 * declaration of a rule set through its `style`. {@link watchSheetEdits} wraps the CSSOM of a window
 * so that they are counted, and {@link SheetMark} tells whether any happened since it was taken:
 * neither serialises a rule, so a still frame costs the same whatever the size of the page's CSS.
 * The count is per window, not per sheet: an edit to a sheet no document uses (a constructed sheet
 * not adopted) counts too.
 */

/** The interfaces whose setters and writing methods {@link watchSheetEdits} wraps. */
const INTERFACES =
  /^(?:CSS\w*Rule|CSSNestedDeclarations|CSSFunctionDeclarations|CSSStyleSheet|StyleSheet|MediaList|CSSStyleDeclaration|StylePropertyMap)$/;

/** Methods of those interfaces that change a sheet, a rule list, a media list or a declaration. */
const WRITERS = new Set([
  "insertRule",
  "deleteRule",
  "addRule",
  "removeRule",
  "replace",
  "replaceSync",
  "appendRule",
  "appendMedium",
  "deleteMedium",
  "setProperty",
  "removeProperty",
  "set",
  "append",
  "delete",
  "clear",
]);

/** Edits counted so far, in every window watched. */
let edits = 0;
const edited = (): void => {
  edits++;
};

/** The `CSSStyleSheet` prototypes of the windows watched. */
const watched = new WeakSet<object>();

/**
 * The declarations of rules that scripts took (`rule.style`), by the outermost sheet holding the
 * rule: setting a property by name (`rule.style.color = ...`) goes through no setter that can be
 * wrapped, so their text is compared instead.
 */
const handed = new WeakMap<CSSStyleSheet, Set<CSSStyleDeclaration>>();

function hand(rule: CSSRule, declaration: CSSStyleDeclaration): void {
  let sheet = rule.parentStyleSheet;
  while (sheet?.ownerRule?.parentStyleSheet) sheet = sheet.ownerRule.parentStyleSheet;
  // A rule deleted from its sheet shows nowhere.
  if (!sheet) return;
  let declarations = handed.get(sheet);
  if (!declarations) {
    declarations = new Set();
    handed.set(sheet, declarations);
  }
  if (declarations.has(declaration)) return;
  declarations.add(declaration);
  // Marks taken before do not compare its text, and a property may be set on it right away.
  edited();
}

/**
 * The inline style maps scripts took from elements (`el.attributeStyleMap`). Like `el.style`,
 * writing one sets the element's `style` attribute, a DOM mutation the watches read box by box. A
 * `StylePropertyMap` has no owner to tell, so a map not seen here counts as an edit: a rule's
 * (`rule.styleMap`), and an element's a script took before its window was watched.
 */
const inlineMaps = new WeakSet<object>();

/** The prototypes that hold `attributeStyleMap` (ElementCSSInlineStyle). */
const INLINE_STYLED = ["HTMLElement", "SVGElement", "MathMLElement"];

/** A declaration of a rule; an element's inline style changes its `style` attribute, a DOM mutation. */
function inRule(target: unknown): boolean {
  return (target as CSSStyleDeclaration).parentRule != null;
}

/** Whether writing through `target`, of interface `name`, may edit a style sheet. */
function counts(name: string, target: unknown): boolean {
  if (name === "CSSStyleDeclaration") return inRule(target);
  if (name === "StylePropertyMap") return !inlineMaps.has(target as object);
  return true;
}

function wrap(name: string, proto: object, key: string, descriptor: PropertyDescriptor): void {
  const declaration = name === "CSSStyleDeclaration";
  const { get, set, value } = descriptor;
  if (set) {
    descriptor.set = function (this: unknown, v: unknown): void {
      if (counts(name, this)) edited();
      Reflect.apply(set, this, [v]);
    };
  }
  // `@font-face` declarations are left out: the walk reads them, and the export keeps each face as
  // first read anyway (FontFaceCache).
  if (get && key === "style" && !declaration && name !== "CSSFontFaceRule") {
    descriptor.get = function (this: CSSRule): unknown {
      const style = Reflect.apply(get, this, []) as CSSStyleDeclaration;
      hand(this, style);
      return style;
    };
  }
  if (typeof value === "function" && WRITERS.has(key)) {
    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      if (counts(name, this)) edited();
      const result = Reflect.apply(value, this, args);
      // `replace()` may set the rules in a later task.
      if (typeof (result as PromiseLike<unknown> | null)?.then === "function") {
        (result as PromiseLike<unknown>).then(edited, edited);
      }
      return result;
    };
  }
  if (descriptor.get !== get || descriptor.set !== set || descriptor.value !== value) {
    Object.defineProperty(proto, key, descriptor);
  }
}

/**
 * Counts the edits made through the CSSOM to the style sheets of `win`'s documents from now on,
 * by any script (the sheets of a frame without scripts are edited from its parent through its
 * prototypes too): the setters and the writing methods of its sheets, rules, media lists and rule
 * declarations are wrapped, and so is the `style` of its rules, whose declarations are compared by
 * text from then on (see {@link handed}). Writes to an element's inline style map do not count
 * ({@link inlineMaps}). Once per window; the wrappers stay with the window. Not seen: a declaration
 * a script took before, then sets by property name, and declarations of `@font-face` rules set that
 * way.
 */
export function watchSheetEdits(win: Window | null): void {
  const realm = win as unknown as Record<string, { prototype?: object } | undefined> | null;
  const key = realm?.CSSStyleSheet?.prototype;
  if (!realm || !key || watched.has(key)) return;
  watched.add(key);
  for (const name of Object.getOwnPropertyNames(realm)) {
    if (!INTERFACES.test(name)) continue;
    const proto = realm[name]?.prototype;
    if (!proto) continue;
    for (const prop of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
      if (descriptor?.configurable) wrap(name, proto, prop, descriptor);
    }
  }
  for (const name of INLINE_STYLED) {
    const proto = realm[name]?.prototype;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "attributeStyleMap");
    const get = descriptor?.get;
    if (!descriptor?.configurable || !get) continue;
    descriptor.get = function (this: Element): unknown {
      const map = Reflect.apply(get, this, []) as object | null;
      if (map) inlineMaps.add(map);
      return map;
    };
    Object.defineProperty(proto, "attributeStyleMap", descriptor);
  }
}

/**
 * The style sheets of some documents and shadow roots at one time, as far as edits through the
 * CSSOM go: the count of edits in the watched windows ({@link watchSheetEdits}) and the text of the
 * rule declarations scripts took. One read per declaration taken, none per rule.
 */
export class SheetMark {
  readonly #edits = edits;
  readonly #texts: [CSSStyleDeclaration, string][] = [];

  constructor(sheets: Iterable<CSSStyleSheet>) {
    for (const sheet of sheets) {
      for (const declaration of handed.get(sheet) ?? []) this.#texts.push([declaration, declaration.cssText]);
    }
  }

  /** Whether no rule was edited in place since, in a watched window. */
  holds(): boolean {
    return edits === this.#edits && this.#texts.every(([declaration, text]) => declaration.cssText === text);
  }
}
