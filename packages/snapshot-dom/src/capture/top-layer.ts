import type { BoxLayer } from "@swarmloom/core";
import { viewOf } from "../dom/env";
import { type Capture, type Ctx, emit, toWorld } from "./state";
import { boxStyle, paintsBox, readBoxVisual } from "./styles";

/**
 * First element of the paint key of top-layer content. In-flow content starts at 1 and stacking
 * contexts of the root at 0, 3 or 4, so top-layer content always paints above the page.
 */
export const TOP_LAYER_KEY = 5;

/** Pseudo-classes of elements rendered in the top layer, tried in order (unsupported ones are skipped). */
const TOP_LAYER_SELECTORS = [":modal", ":popover-open", ":fullscreen"] as const;

/**
 * True for an open modal dialog, an open popover or the fullscreen element. Such elements escape
 * ancestor clips, transforms and z-index and are part of the screen layer (decisions-v1 S01).
 * Only fixed elements are checked: every top-layer element is fixed by user-agent style.
 */
export function isTopLayer(el: Element): boolean {
  for (const selector of TOP_LAYER_SELECTORS) {
    try {
      if (el.matches(selector)) return true;
    } catch {
      // Engines without this pseudo-class throw a SyntaxError; nothing of that kind is open there.
    }
  }
  return false;
}

/** Emits the `::backdrop` of a top-layer element as a viewport-sized box below it. */
export function emitBackdrop(cap: Capture, ctx: Ctx, el: Element): string | null {
  const view = viewOf(el);
  let cs: CSSStyleDeclaration;
  try {
    cs = view.getComputedStyle(el, "::backdrop");
  } catch {
    return null;
  }
  const v = readBoxVisual(cs);
  if (!paintsBox(v)) return null;
  const viewport = {
    left: 0,
    top: 0,
    width: cap.doc.documentElement.clientWidth || view.innerWidth,
    height: view.innerHeight,
  };
  const style = boxStyle(cs, v, el.baseURI || cap.doc.baseURI);
  return emit<BoxLayer>(cap, ctx, { kind: "box", box: toWorld(cap, ctx, viewport), style, meta: { backdrop: true } });
}
