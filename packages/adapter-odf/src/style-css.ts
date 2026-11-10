import type { CSSMap } from "@swarmloom/core";
import { cssColor, keyword, lengthPx, percent, px, styleText } from "./kit/css";
import type { FontReport } from "./kit/fonts";
import type { OdfStyles, Props, ResolvedStyle } from "./styles";

type Map_ = ReadonlyMap<string, string> | undefined;

const BORDER_STYLES = [
  "none",
  "hidden",
  "solid",
  "dotted",
  "dashed",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
] as const;

/** Parses an ODF border ("0.5pt solid #000000") into a safe CSS border value. */
export function border(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.trim() === "none") return "none";
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const token of value.trim().split(/\s+/)) {
    const len = lengthPx(token);
    if (len !== undefined) width = px(Math.max(len, 0.75));
    else if (keyword(token, BORDER_STYLES)) style = token.toLowerCase();
    else if (keyword(token, ["thin", "medium", "thick"] as const)) width = token.toLowerCase();
    else color = cssColor(token) ?? color;
  }
  return style ? [width ?? "1px", style, color ?? "currentColor"].join(" ") : undefined;
}

function setLength(css: CSSMap, prop: string, value: string | undefined): void {
  const n = lengthPx(value);
  if (n !== undefined) css[prop] = px(n);
}

function boxSides(css: CSSMap, m: Map_, odf: "fo:margin" | "fo:padding", prop: "margin" | "padding"): void {
  if (!m) return;
  setLength(css, prop, m.get(odf));
  for (const side of ["top", "right", "bottom", "left"]) setLength(css, `${prop}-${side}`, m.get(`${odf}-${side}`));
}

function borders(css: CSSMap, m: Map_): void {
  if (!m) return;
  const all = border(m.get("fo:border"));
  if (all) css.border = all;
  for (const side of ["top", "right", "bottom", "left"]) {
    const b = border(m.get(`fo:border-${side}`));
    if (b) css[`border-${side}`] = b;
  }
}

function background(css: CSSMap, m: Map_): void {
  const bg = m?.get("fo:background-color");
  if (bg === "transparent") css["background-color"] = "transparent";
  else if (cssColor(bg)) css["background-color"] = bg as string;
}

/** CSS of `style:text-properties`. */
export function textCss(m: Map_, styles: OdfStyles, fonts: FontReport): CSSMap {
  const css: CSSMap = {};
  if (!m) return css;
  const size = lengthPx(m.get("fo:font-size"), "pt");
  if (size !== undefined && size > 0) css["font-size"] = px(Math.min(size, 400));
  const weight = m.get("fo:font-weight");
  if (weight && /^(?:normal|bold|[1-9]00)$/.test(weight)) css["font-weight"] = weight;
  const style = keyword(m.get("fo:font-style"), ["normal", "italic", "oblique"] as const);
  if (style) css["font-style"] = style;
  const color = cssColor(m.get("fo:color"));
  if (color && m.get("style:use-window-font-color") !== "true") css.color = color;
  background(css, m);
  const deco: string[] = [];
  const under = m.get("style:text-underline-style");
  if (under && under !== "none") deco.push("underline");
  const through = m.get("style:text-line-through-style");
  if (through && through !== "none") deco.push("line-through");
  if (deco.length > 0) css["text-decoration"] = deco.join(" ");
  else if (under === "none" || through === "none") css["text-decoration"] = "none";
  const caps = keyword(m.get("fo:font-variant"), ["normal", "small-caps"] as const);
  if (caps) css["font-variant"] = caps;
  const transform = keyword(m.get("fo:text-transform"), ["none", "uppercase", "lowercase", "capitalize"] as const);
  if (transform) css["text-transform"] = transform;
  setLength(css, "letter-spacing", m.get("fo:letter-spacing"));
  const position = m.get("style:text-position")?.trim().split(/\s+/);
  if (position && position[0] !== "0%" && position[0] !== "0") {
    const shift = position[0] === "super" ? "super" : position[0] === "sub" ? "sub" : undefined;
    const pct = percent(position[0]);
    if (shift) css["vertical-align"] = shift;
    else if (pct !== undefined) css["vertical-align"] = pct > 0 ? "super" : "sub";
    const scale = percent(position[1] ?? "58%");
    if (css["vertical-align"] && scale) css["font-size"] = `${Math.round(scale * 100)}%`;
  }
  const names = [m.get("style:font-name"), m.get("style:font-name-asian")]
    .map((n) => styles.font(n))
    .filter((f) => f !== undefined);
  const direct = m.get("fo:font-family");
  if (direct) names.unshift({ family: direct.replace(/^['"]|['"]$/g, "") });
  if (names.length > 0)
    css["font-family"] = fonts.useAll(
      names.map((f) => f.family),
      names[0]?.generic,
    );
  return css;
}

/** CSS of `style:paragraph-properties`. */
export function paragraphCss(m: Map_): CSSMap {
  const css: CSSMap = {};
  if (!m) return css;
  const align = m.get("fo:text-align");
  const map: Record<string, string> = {
    start: "start",
    end: "end",
    left: "left",
    right: "right",
    center: "center",
    justify: "justify",
  };
  if (align && map[align]) css["text-align"] = map[align] as string;
  boxSides(css, m, "fo:margin", "margin");
  boxSides(css, m, "fo:padding", "padding");
  borders(css, m);
  background(css, m);
  setLength(css, "text-indent", m.get("fo:text-indent"));
  const lh = m.get("fo:line-height");
  const pct = percent(lh);
  if (pct !== undefined && pct > 0) css["line-height"] = String(Math.round(pct * 100) / 100);
  else if (lh === "normal") css["line-height"] = "normal";
  else setLength(css, "line-height", lh);
  return css;
}

/** CSS of `style:table-cell-properties`. */
export function cellCss(m: Map_): CSSMap {
  const css: CSSMap = {};
  if (!m) return css;
  background(css, m);
  borders(css, m);
  boxSides(css, m, "fo:padding", "padding");
  const v = keyword(m.get("style:vertical-align"), ["top", "middle", "bottom"] as const);
  if (v) css["vertical-align"] = v;
  return css;
}

/** CSS of `style:graphic-properties` for frames laid out as HTML boxes. */
export function graphicBoxCss(m: Map_): CSSMap {
  const css: CSSMap = {};
  if (!m) return css;
  boxSides(css, m, "fo:padding", "padding");
  borders(css, m);
  background(css, m);
  if (m.get("draw:fill") === "solid" && cssColor(m.get("draw:fill-color"))) {
    css["background-color"] = m.get("draw:fill-color") as string;
  }
  return css;
}

/** Which property groups become CSS for a style family. */
const FAMILY_KINDS: Record<string, readonly ("paragraph" | "text" | "table-cell" | "graphic")[]> = {
  paragraph: ["paragraph", "text"],
  text: ["text"],
  "table-cell": ["table-cell", "paragraph", "text"],
  graphic: ["graphic", "paragraph", "text"],
  presentation: ["graphic", "paragraph", "text"],
};

/** All CSS of a resolved style for its family. */
export function styleCss(style: ResolvedStyle | Props, styles: OdfStyles, fonts: FontReport, family: string): CSSMap {
  const props: Props = "props" in style ? (style as ResolvedStyle).props : (style as Props);
  const css: CSSMap = {};
  for (const kind of FAMILY_KINDS[family] ?? []) {
    if (kind === "paragraph") Object.assign(css, paragraphCss(props.paragraph));
    else if (kind === "text") Object.assign(css, textCss(props.text, styles, fonts));
    else if (kind === "table-cell") Object.assign(css, cellCss(props["table-cell"]));
    else Object.assign(css, graphicBoxCss(props.graphic));
  }
  return css;
}

/**
 * Turns resolved styles into CSS classes, once each. Rules are scoped under the document root
 * class so they outrank the element resets of the document style sheet.
 */
export class StyleClasses {
  private readonly classes = new Map<string, string>();
  private readonly rules: string[] = [];

  constructor(
    private readonly styles: OdfStyles,
    readonly fonts: FontReport,
    private readonly root: string,
  ) {}

  /** Class for `family/name` (resolved in `scope`), or "" when the style is unknown or empty. */
  of(family: string, name: string | null | undefined, scope: "content" | "styles" = "content"): string {
    if (!name) return "";
    const key = `${scope}:${family}/${name}`;
    const known = this.classes.get(key);
    if (known !== undefined) return known;
    const style = this.styles.resolve(family, name, scope);
    const text = style ? styleText(styleCss(style, this.styles, this.fonts, family)) : "";
    const cls = text ? `s${this.classes.size + 1}` : "";
    if (cls) this.rules.push(`.${this.root} .${cls}{${text}}`);
    this.classes.set(key, cls);
    return cls;
  }

  /** Accumulated rules. */
  css(): string {
    return this.rules.join("");
  }
}
