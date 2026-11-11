import type { Size } from "@swarmloom/core";
import type { AnimationItem } from "lottie-web";
import { LottieError } from "../errors";
import type { LottieRuntime } from "./runtime";

/** A Lottie animation rendered off-screen so frames can be measured and serialised. */
export interface RenderedLottie {
  readonly item: AnimationItem;
  readonly svg: SVGSVGElement;
  /** Shows a frame index (from the in point). */
  show(index: number): void;
  dispose(): void;
}

/**
 * Renders sanitised Lottie JSON with lottie-web's SVG renderer in an invisible, isolated host of
 * `ctx.document` (closed shadow root, opacity 0, no pointer events, `contain: strict`). It stays
 * rendered because measurement needs layout. Nothing plays: frames are shown with `goToAndStop`.
 *
 * @throws LottieError ("render") when lottie-web cannot build the animation.
 */
export function renderLottie(runtime: LottieRuntime, doc: Document, json: string, size: Size): RenderedLottie {
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-swarmloom-sandbox", "lottie");
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
  const root = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "closed" }) : host;
  const box = doc.createElement("div");
  box.style.cssText = `all:initial;display:block;position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px`;
  root.appendChild(box);
  (doc.body ?? doc.documentElement).appendChild(host);

  let item: AnimationItem;
  try {
    item = runtime.loadAnimation({
      container: box,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: JSON.parse(json),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false, hideOnTransparent: true },
    });
  } catch (error) {
    host.remove();
    throw new LottieError("render", "This Lottie animation could not be drawn.", { cause: error });
  }
  const svg = box.querySelector("svg");
  if (!svg || !item.isLoaded) {
    item.destroy();
    host.remove();
    throw new LottieError("render", "This Lottie animation could not be drawn.");
  }
  return {
    item,
    svg,
    show(index) {
      item.goToAndStop(index, true);
    },
    dispose() {
      item.destroy();
      host.remove();
    },
  };
}
