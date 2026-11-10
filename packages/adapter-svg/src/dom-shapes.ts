import { type PathSegment, parsePathData } from "./path/parse";
import { ellipseSegments, lineSegments, parsePoints, polySegments, rectSegments } from "./path/shapes";

/** Shape elements converted into path layers. */
export const SHAPE_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

type LengthHost = Record<string, SVGAnimatedLength | undefined>;

/**
 * Geometry property in user units. SVG 2 makes x/y/width/height/cx/cy/r/rx/ry CSS properties, so a
 * computed px value (from a stylesheet) wins; otherwise the attribute's resolved base value is
 * used, which handles units and percentages against the viewport.
 */
function geometry(el: Element, cs: CSSStyleDeclaration, name: string): number {
  const computed = cs.getPropertyValue(name);
  if (computed.endsWith("px")) {
    const v = Number.parseFloat(computed);
    if (Number.isFinite(v)) return v;
  }
  const animated = (el as unknown as LengthHost)[name];
  return animated?.baseVal?.value ?? 0;
}

/** `rx`/`ry` with "auto" (missing or keyword) as undefined. */
function radius(el: Element, cs: CSSStyleDeclaration, name: "rx" | "ry"): number | undefined {
  const computed = cs.getPropertyValue(name);
  if (computed === "auto" || (computed === "" && !el.hasAttribute(name))) return undefined;
  if (!computed && el.getAttribute(name) === "auto") return undefined;
  return geometry(el, cs, name);
}

/** Path data of a `path`, from its attribute or the CSS `d` property. */
function pathData(el: Element, cs: CSSStyleDeclaration): string {
  const attr = el.getAttribute("d");
  if (attr) return attr;
  const css = cs.getPropertyValue("d");
  const m = /^path\(\s*(["'])(.*)\1\s*\)$/s.exec(css.trim());
  return m?.[2] ?? "";
}

/** User-space geometry of a basic shape or path element; empty when it renders nothing. */
export function elementSegments(el: Element, cs: CSSStyleDeclaration): PathSegment[] {
  const g = (name: string): number => geometry(el, cs, name);
  switch (el.localName) {
    case "path":
      return parsePathData(pathData(el, cs)).segments;
    case "rect":
      return rectSegments(g("x"), g("y"), g("width"), g("height"), radius(el, cs, "rx"), radius(el, cs, "ry"));
    case "circle": {
      const r = g("r");
      return ellipseSegments(g("cx"), g("cy"), r, r);
    }
    case "ellipse": {
      let rx = radius(el, cs, "rx");
      let ry = radius(el, cs, "ry");
      rx ??= ry;
      ry ??= rx;
      return ellipseSegments(g("cx"), g("cy"), rx ?? 0, ry ?? 0);
    }
    case "line":
      return lineSegments(g("x1"), g("y1"), g("x2"), g("y2"));
    case "polyline":
    case "polygon":
      return polySegments(parsePoints(el.getAttribute("points") ?? ""), el.localName === "polygon");
    default:
      return [];
  }
}
