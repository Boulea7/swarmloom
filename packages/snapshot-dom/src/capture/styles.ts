import type { CSSMap } from "@swarmloom/core";
import { isVisibleColor } from "../util/color";
import { fontFamilies, px, rewriteUrls } from "../util/css";
import { safeImageUrl } from "../util/html";
import type { Capture, ElInfo } from "./state";

/** Inherited text properties: full set on text containers, diffed on inline descendants. */
const INHERITED_TEXT = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "font-stretch",
  "font-feature-settings",
  "font-variation-settings",
  "font-kerning",
  "line-height",
  "color",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "text-shadow",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-width",
  "-webkit-text-stroke-color",
  "text-underline-offset",
  "direction",
  "writing-mode",
  "tab-size",
  "text-wrap",
] as const;

/** Inherited, but only meaningful on block containers. */
const BLOCK_TEXT = ["text-align", "text-indent"] as const;

const ALWAYS = new Set<string>(["font-family", "font-size", "font-weight", "line-height", "color"]);

/** Initial values; text containers omit properties at these values. */
const TEXT_DEFAULTS: Readonly<Record<string, string>> = {
  "font-style": "normal",
  "font-variant": "normal",
  "font-stretch": "100%",
  "font-feature-settings": "normal",
  "font-variation-settings": "normal",
  "font-kerning": "auto",
  "letter-spacing": "normal",
  "word-spacing": "0px",
  "text-transform": "none",
  "text-shadow": "none",
  "white-space": "normal",
  "word-break": "normal",
  "overflow-wrap": "normal",
  hyphens: "manual",
  "-webkit-text-fill-color": "",
  "-webkit-text-stroke-width": "0px",
  "-webkit-text-stroke-color": "",
  "text-underline-offset": "auto",
  direction: "ltr",
  "writing-mode": "horizontal-tb",
  "tab-size": "8",
  "text-wrap": "wrap",
  "text-align": "start",
  "text-indent": "0px",
};

export type TextProps = Readonly<Record<string, string>>;

/** Reads the inherited text properties of a computed style, normalising implicit defaults. */
export function readTextProps(cs: CSSStyleDeclaration, families?: Set<string>): TextProps {
  const out: Record<string, string> = {};
  for (const name of INHERITED_TEXT) out[name] = cs.getPropertyValue(name);
  for (const name of BLOCK_TEXT) out[name] = cs.getPropertyValue(name);
  // Fill and stroke colours default to `color`; keep them only when set explicitly.
  if (out["-webkit-text-fill-color"] === out.color) out["-webkit-text-fill-color"] = "";
  if (px(out["-webkit-text-stroke-width"]) === 0) {
    out["-webkit-text-stroke-width"] = "0px";
    out["-webkit-text-stroke-color"] = "";
  }
  if (out["text-align"] === "left" && out.direction !== "rtl") out["text-align"] = "start";
  if (out["font-stretch"] === "normal") out["font-stretch"] = "100%";
  if (families) for (const family of fontFamilies(out["font-family"] ?? "")) families.add(family);
  return out;
}

/** Cached {@link readTextProps} of an element; records the font families it uses. */
export function textPropsOf(cap: Capture, info: ElInfo): TextProps {
  if (!info.textProps) info.textProps = readTextProps(info.cs, cap.families);
  return info.textProps;
}

/** Full text style of a text container (non-default values only, plus the always-set core). */
export function containerTextStyle(props: TextProps): CSSMap {
  const out: CSSMap = {};
  for (const [name, value] of Object.entries(props)) {
    if (!value) continue;
    if (ALWAYS.has(name) || TEXT_DEFAULTS[name] !== value) out[name] = value;
  }
  return out;
}

/** Inherited text properties of `own` that differ from `parent` (block-only ones excluded). */
export function diffTextStyle(parent: TextProps, own: TextProps, out: CSSMap): CSSMap {
  for (const name of INHERITED_TEXT) {
    const v = own[name] ?? "";
    if (v !== (parent[name] ?? "")) out[name] = v || TEXT_DEFAULTS[name] || "initial";
  }
  return out;
}

const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

export interface SideBorder {
  side: Side;
  width: number;
  style: string;
  color: string;
  visible: boolean;
}

/** What makes an element paint as a box. */
export interface BoxVisual {
  fill: boolean;
  image: boolean;
  /** background-clip: text (gradient text): the background paints glyphs, not a box. */
  textClip: boolean;
  shadow: boolean;
  backdrop: boolean;
  outline: boolean;
  sides: SideBorder[];
  anySide: boolean;
  allSides: boolean;
}

export function readSides(cs: CSSStyleDeclaration): SideBorder[] {
  return SIDES.map((side) => {
    const width = px(cs.getPropertyValue(`border-${side}-width`));
    if (width <= 0) return { side, width: 0, style: "none", color: "", visible: false };
    const style = cs.getPropertyValue(`border-${side}-style`);
    const color = cs.getPropertyValue(`border-${side}-color`);
    const visible = style !== "none" && style !== "hidden" && isVisibleColor(color);
    return { side, width, style, color, visible };
  });
}

export function readBoxVisual(cs: CSSStyleDeclaration): BoxVisual {
  const clip = cs.getPropertyValue("background-clip") || cs.getPropertyValue("-webkit-background-clip");
  const textClip = clip === "text";
  const fill = !textClip && isVisibleColor(cs.backgroundColor);
  const image = !textClip && cs.backgroundImage !== "none" && cs.backgroundImage !== "";
  const shadow = cs.boxShadow !== "none" && cs.boxShadow !== "";
  const backdrop =
    isSet(cs.getPropertyValue("backdrop-filter")) || isSet(cs.getPropertyValue("-webkit-backdrop-filter"));
  const outlineStyle = cs.getPropertyValue("outline-style");
  const outline = outlineStyle !== "none" && outlineStyle !== "" && px(cs.getPropertyValue("outline-width")) > 0;
  const sides = readSides(cs);
  const anySide = sides.some((s) => s.visible);
  const allSides = sides.every((s) => s.visible);
  return { fill, image, textClip, shadow, backdrop, outline, sides, anySide, allSides };
}

/** Cached {@link readBoxVisual} of an element. */
export function visualOf(info: ElInfo): BoxVisual {
  if (!info.visual) info.visual = readBoxVisual(info.cs);
  return info.visual;
}

function isSet(v: string): boolean {
  return v !== "" && v !== "none";
}

/** True when the element paints a box (fill, image, shadow, backdrop, outline or a complete border). */
export function paintsBox(v: BoxVisual): boolean {
  return v.fill || v.image || v.shadow || v.backdrop || v.outline || v.allSides;
}

/** Rewrites url() references to absolute, safe image URLs (others become `none`). */
export function safeCssImages(value: string, base: string): string {
  return rewriteUrls(value, (url) => safeImageUrl(url, base));
}

function radii(cs: CSSStyleDeclaration, out: CSSMap): void {
  const tl = cs.getPropertyValue("border-top-left-radius");
  const tr = cs.getPropertyValue("border-top-right-radius");
  const br = cs.getPropertyValue("border-bottom-right-radius");
  const bl = cs.getPropertyValue("border-bottom-left-radius");
  if (tl === tr && tr === br && br === bl) {
    if (tl && tl !== "0px") out["border-radius"] = tl;
    return;
  }
  if (tl !== "0px") out["border-top-left-radius"] = tl;
  if (tr !== "0px") out["border-top-right-radius"] = tr;
  if (br !== "0px") out["border-bottom-right-radius"] = br;
  if (bl !== "0px") out["border-bottom-left-radius"] = bl;
}

function background(cs: CSSStyleDeclaration, v: BoxVisual, base: string, out: CSSMap): void {
  if (v.fill) out["background-color"] = cs.backgroundColor;
  if (v.image) {
    out["background-image"] = safeCssImages(cs.backgroundImage, base);
    out["background-size"] = cs.getPropertyValue("background-size");
    out["background-position"] = cs.getPropertyValue("background-position");
    out["background-repeat"] = cs.getPropertyValue("background-repeat");
    const origin = cs.getPropertyValue("background-origin");
    if (origin && origin !== "padding-box") out["background-origin"] = origin;
    const blend = cs.getPropertyValue("background-blend-mode");
    if (blend && blend !== "normal") out["background-blend-mode"] = blend;
  }
  if (v.fill || v.image) {
    const clip = cs.getPropertyValue("background-clip");
    if (clip && clip !== "border-box") out["background-clip"] = clip;
  }
}

function effects(cs: CSSStyleDeclaration, v: BoxVisual, base: string, out: CSSMap): void {
  if (v.shadow) out["box-shadow"] = cs.boxShadow;
  if (v.backdrop) {
    const b = cs.getPropertyValue("backdrop-filter") || cs.getPropertyValue("-webkit-backdrop-filter");
    out["backdrop-filter"] = b;
    out["-webkit-backdrop-filter"] = b;
  }
  if (v.outline) {
    out.outline = `${cs.getPropertyValue("outline-width")} ${cs.getPropertyValue("outline-style")} ${cs.getPropertyValue("outline-color")}`;
    const offset = cs.getPropertyValue("outline-offset");
    if (offset && offset !== "0px") out["outline-offset"] = offset;
  }
  const filter = cs.getPropertyValue("filter");
  if (isSet(filter)) out.filter = filter;
  const blend = cs.getPropertyValue("mix-blend-mode");
  if (blend && blend !== "normal") out["mix-blend-mode"] = blend;
  const clipPath = cs.getPropertyValue("clip-path");
  if (isSet(clipPath)) out["clip-path"] = clipPath;
  const mask = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
  if (isSet(mask)) {
    const m = safeCssImages(mask, base);
    out["mask-image"] = m;
    out["-webkit-mask-image"] = m;
    for (const p of ["mask-size", "mask-position", "mask-repeat"]) {
      const val = cs.getPropertyValue(p) || cs.getPropertyValue(`-webkit-${p}`);
      if (val) {
        out[p] = val;
        out[`-webkit-${p}`] = val;
      }
    }
  }
}

/**
 * CSSMap of a box layer: fills, gradients/images, visible borders, radii, shadows, backdrop and
 * other effects. Always `box-sizing: border-box`, because the layer box is the border box.
 */
export function boxStyle(cs: CSSStyleDeclaration, v: BoxVisual, base: string): CSSMap {
  const out: CSSMap = { "box-sizing": "border-box" };
  background(cs, v, base, out);
  for (const s of v.sides) if (s.visible) out[`border-${s.side}`] = `${s.width}px ${s.style} ${s.color}`;
  radii(cs, out);
  effects(cs, v, base, out);
  return out;
}

/** Decorative box properties of an inline element inside a text block (non-default values only). */
export function inlineBoxStyle(cs: CSSStyleDeclaration, base: string, out: CSSMap): CSSMap {
  const v = readBoxVisual(cs);
  background(cs, v, base, out);
  if (v.textClip) {
    const img = cs.backgroundImage;
    if (img && img !== "none") out["background-image"] = safeCssImages(img, base);
    out["background-clip"] = "text";
    out["-webkit-background-clip"] = "text";
  }
  for (const s of v.sides) if (s.visible) out[`border-${s.side}`] = `${s.width}px ${s.style} ${s.color}`;
  if (v.fill || v.image || v.anySide) radii(cs, out);
  if (v.shadow) out["box-shadow"] = cs.boxShadow;
  for (const side of SIDES) {
    const p = cs.getPropertyValue(`padding-${side}`);
    if (p && p !== "0px") out[`padding-${side}`] = p;
    const m = cs.getPropertyValue(`margin-${side}`);
    if (m && m !== "0px") out[`margin-${side}`] = m;
  }
  const deco = cs.getPropertyValue("text-decoration-line");
  if (deco && deco !== "none") {
    out["text-decoration"] =
      `${deco} ${cs.getPropertyValue("text-decoration-style")} ${cs.getPropertyValue("text-decoration-color")}`;
    const thickness = cs.getPropertyValue("text-decoration-thickness");
    if (thickness && thickness !== "auto") out["text-decoration-thickness"] = thickness;
  }
  const va = cs.getPropertyValue("vertical-align");
  if (va && va !== "baseline") out["vertical-align"] = va;
  const breakMode = cs.getPropertyValue("box-decoration-break") || cs.getPropertyValue("-webkit-box-decoration-break");
  if (breakMode === "clone") {
    out["box-decoration-break"] = "clone";
    out["-webkit-box-decoration-break"] = "clone";
  }
  return out;
}

/** Layout properties of a flex/grid container rendered as one text block. */
export function flexLayoutStyle(cs: CSSStyleDeclaration, out: CSSMap): CSSMap {
  const display = cs.display;
  if (display.includes("grid")) {
    out.display = "grid";
    for (const p of ["grid-template-columns", "grid-template-rows", "grid-auto-flow", "justify-items"]) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "none" && v !== "normal") out[p] = v;
    }
  } else {
    out.display = "flex";
    const dir = cs.getPropertyValue("flex-direction");
    if (dir && dir !== "row") out["flex-direction"] = dir;
    const wrap = cs.getPropertyValue("flex-wrap");
    if (wrap && wrap !== "nowrap") out["flex-wrap"] = wrap;
  }
  for (const p of ["align-items", "justify-content", "align-content", "row-gap", "column-gap"]) {
    const v = cs.getPropertyValue(p);
    if (v && v !== "normal") out[p] = v;
  }
  return out;
}

/** Flex/grid item properties of an element inside a flex text block. */
export function flexItemStyle(cs: CSSStyleDeclaration, out: CSSMap): CSSMap {
  const grow = cs.getPropertyValue("flex-grow");
  if (grow && grow !== "0") out["flex-grow"] = grow;
  const shrink = cs.getPropertyValue("flex-shrink");
  if (shrink && shrink !== "1") out["flex-shrink"] = shrink;
  const basis = cs.getPropertyValue("flex-basis");
  if (basis && basis !== "auto") out["flex-basis"] = basis;
  const self = cs.getPropertyValue("align-self");
  if (self && self !== "auto") out["align-self"] = self;
  const order = cs.getPropertyValue("order");
  if (order && order !== "0") out.order = order;
  return out;
}

/** Content box of an element given its world border box. */
export function contentInsets(cs: CSSStyleDeclaration): [number, number, number, number] {
  return [
    px(cs.borderTopWidth) + px(cs.paddingTop),
    px(cs.borderRightWidth) + px(cs.paddingRight),
    px(cs.borderBottomWidth) + px(cs.paddingBottom),
    px(cs.borderLeftWidth) + px(cs.paddingLeft),
  ];
}

export function borderInsets(cs: CSSStyleDeclaration): [number, number, number, number] {
  return [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
}
