import type { Size } from "@swarmloom/core";
import { type Matrix, translate } from "./path/geometry";

/** A sanitised SVG laid out off-screen so the browser resolves CSS, transforms and text metrics. */
export interface Sandbox {
  readonly svg: SVGSVGElement;
  /** Maps client (viewport) coordinates to stage coordinates. */
  readonly clientToStage: Matrix;
  dispose(): void;
}

/**
 * Mounts `svg` (already imported into `doc`) in an invisible, isolated host. A closed shadow root
 * keeps the SVG's `<style>` rules from leaking into the page and the page's styles out of the SVG.
 * The host stays rendered (opacity 0, no pointer events) because `display:none` and
 * `visibility:hidden` would break measurement and computed visibility.
 */
export function mountSandbox(doc: Document, svg: SVGSVGElement, size: Size): Sandbox {
  if (!doc.defaultView) throw new Error("The SVG adapter needs a document with a window to measure layout");
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-swarmloom-sandbox", "svg");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${size.w}px`,
    `height:${size.h}px`,
    "opacity:0",
    "pointer-events:none",
    "overflow:hidden",
    "contain:strict",
    "z-index:-2147483647",
  ].join(";");
  const shadow = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "closed" }) : host;
  const wrapper = doc.createElement("div");
  wrapper.style.cssText = `all:initial;display:block;position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px;color:#000;font:16px sans-serif`;
  svg.style.display = "block";
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.margin = "0";
  svg.style.padding = "0";
  svg.style.border = "0";
  svg.style.width = `${size.w}px`;
  svg.style.height = `${size.h}px`;
  wrapper.appendChild(svg);
  shadow.appendChild(wrapper);
  (doc.body ?? doc.documentElement).appendChild(host);
  const rect = svg.getBoundingClientRect();
  return {
    svg,
    clientToStage: translate(-rect.left, -rect.top),
    dispose: () => host.remove(),
  };
}
