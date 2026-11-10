import type { Rect } from "@swarmloom/core";
import { formatNumber, type Matrix, matrixToString } from "./path/geometry";
import { RawCopier } from "./raw";
import { SVG_NS } from "./units";

/**
 * Renders one sandbox element as a standalone SVG data URL, used when an element cannot be
 * expressed as stage layers faithfully (text on a path, gradient-filled or masked text).
 * The element keeps its own presentation; `m` maps its user space to stage coordinates and
 * `box` (stage coordinates) becomes the image viewport.
 */
export function snapshotElement(el: Element, m: Matrix, box: Rect, byId: ReadonlyMap<string, Element>): string {
  const doc = el.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", formatNumber(box.w, 3));
  svg.setAttribute("height", formatNumber(box.h, 3));
  svg.setAttribute("viewBox", [box.x, box.y, box.w, box.h].map((v) => formatNumber(v, 3)).join(" "));
  const defs = doc.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  let n = 0;
  const raw = new RawCopier(byId, defs, (kind) => `s${kind}${n++}`);
  const g = doc.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", matrixToString(m));
  g.appendChild(raw.clone(el, { dropTransform: true }));
  svg.appendChild(g);
  if (!defs.hasChildNodes()) defs.remove();
  const markup = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
