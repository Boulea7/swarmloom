import type { BoxLayer, CSSMap, LayerRole, PathLayer, Rect } from "@swarmloom/core";
import { isVisibleColor } from "../util/color";
import type { Placement } from "./place";
import { type Capture, type Ctx, type ElInfo, emit } from "./state";
import { type BoxVisual, boxStyle, type SideBorder } from "./styles";

const BOX_ROLE: Readonly<Record<string, LayerRole>> = {
  section: "section",
  article: "section",
  main: "section",
  header: "section",
  footer: "section",
  aside: "section",
  nav: "nav",
  ul: "list",
  ol: "list",
  li: "list-item",
  table: "table",
  tr: "row",
  td: "cell",
  th: "cell",
  figure: "figure",
  blockquote: "quote",
  pre: "code",
  button: "button",
  input: "input",
  select: "input",
  textarea: "input",
};

function boxRole(el: Element): LayerRole | undefined {
  const aria = el.getAttribute("role");
  if (aria === "button" || aria === "navigation") return aria === "navigation" ? "nav" : "button";
  return BOX_ROLE[el.localName];
}

/** Native-looking controls report 3D border styles that would render as bevels; draw them flat. */
export function flattenNativeBorders(cs: CSSStyleDeclaration, style: CSSMap): void {
  const appearance = cs.getPropertyValue("appearance") || cs.getPropertyValue("-webkit-appearance");
  if (!appearance || appearance === "none") return;
  let changed = false;
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = style[`border-${side}`];
    if (value && /\b(?:inset|outset|groove|ridge)\b/.test(value)) {
      style[`border-${side}`] = `1px solid ${cs.getPropertyValue(`border-${side}-color`)}`;
      changed = true;
    }
  }
  if (changed && !style["border-radius"]) style["border-radius"] = "3px";
}

/** Emits the styled box of an element. */
export function emitBox(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement, v: BoxVisual): string | null {
  const style = boxStyle(info.cs, v, info.el.baseURI || cap.doc.baseURI);
  flattenNativeBorders(info.cs, style);
  const draft: Omit<BoxLayer, "id"> = { kind: "box", box: place.box, style };
  const role = boxRole(info.el);
  if (role) draft.role = role;
  if (place.transform) draft.transform = place.transform;
  return emit<BoxLayer>(cap, ctx, draft);
}

function dashArray(style: string, width: number): Record<string, string> | undefined {
  if (style === "dashed") return { "stroke-dasharray": `${round(width * 3)} ${round(width * 2)}` };
  if (style === "dotted") return { "stroke-dasharray": `0 ${round(width * 2)}`, "stroke-linecap": "round" };
  return undefined;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Path data and bounds of one border side drawn as a stroke along its centre line. */
export function sideLine(box: Rect, s: SideBorder): { d: string; bounds: Rect } {
  const half = s.width / 2;
  const { x, y, w, h } = box;
  switch (s.side) {
    case "top":
      return { d: `M${round(x)} ${round(y + half)}H${round(x + w)}`, bounds: { x, y, w, h: s.width } };
    case "bottom":
      return {
        d: `M${round(x)} ${round(y + h - half)}H${round(x + w)}`,
        bounds: { x, y: y + h - s.width, w, h: s.width },
      };
    case "left":
      return { d: `M${round(x + half)} ${round(y)}V${round(y + h)}`, bounds: { x, y, w: s.width, h } };
    default:
      return {
        d: `M${round(x + w - half)} ${round(y)}V${round(y + h)}`,
        bounds: { x: x + w - s.width, y, w: s.width, h },
      };
  }
}

/** Single visible border sides without a box (dividers, underlines, rules) become stroked paths. */
export function emitSides(cap: Capture, ctx: Ctx, place: Placement, v: BoxVisual): void {
  for (const s of v.sides) {
    if (!s.visible) continue;
    const { d, bounds } = sideLine(place.box, s);
    const draft: Omit<PathLayer, "id"> = {
      kind: "path",
      box: bounds,
      d,
      stroke: s.color,
      strokeWidth: s.width,
      fill: "none",
    };
    const attrs = dashArray(s.style, s.width);
    if (attrs) draft.attrs = attrs;
    if (place.transform) draft.transform = place.transform;
    emit<PathLayer>(cap, ctx, draft);
  }
}

/**
 * `<hr>`: thin rules become one stroked path along the long axis, coloured by the top border or
 * the background; thick or gradient rules stay boxes. Returns false when nothing is drawn as a path.
 */
export function emitRule(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement, v: BoxVisual): boolean {
  const { x, y, w, h } = place.box;
  const horizontal = w >= h;
  const thickness = horizontal ? h : w;
  if (thickness > 4 || v.image || v.shadow) return false;
  const cs = info.cs;
  const color = v.sides.find((s) => s.visible)?.color ?? (isVisibleColor(cs.backgroundColor) ? cs.backgroundColor : "");
  if (!color) return true;
  const sw = Math.max(1, thickness);
  const d = horizontal
    ? `M${round(x)} ${round(y + h / 2)}H${round(x + w)}`
    : `M${round(x + w / 2)} ${round(y)}V${round(y + h)}`;
  const draft: Omit<PathLayer, "id"> = {
    kind: "path",
    box: horizontal ? { x, y, w, h: sw } : { x, y, w: sw, h },
    d,
    stroke: color,
    strokeWidth: sw,
    fill: "none",
    role: "separator",
  };
  const style = v.sides.find((s) => s.visible)?.style;
  const attrs = style ? dashArray(style, sw) : undefined;
  if (attrs) draft.attrs = attrs;
  if (place.transform) draft.transform = place.transform;
  emit<PathLayer>(cap, ctx, draft);
  return true;
}
