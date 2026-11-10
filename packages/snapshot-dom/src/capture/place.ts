import type { Rect } from "@swarmloom/core";
import { isHtmlElement } from "../dom/env";
import { inset, linearToCss } from "../util/geom";
import { type Capture, type Ctx, type ElInfo, rectOf, toWorld } from "./state";

export interface Placement {
  box: Rect;
  transform?: string;
}

/** Untransformed layout size of an element's border box. */
export function layoutSize(info: ElInfo): { w: number; h: number } {
  const el = info.el;
  if (isHtmlElement(el) && el.offsetWidth + el.offsetHeight > 0) return { w: el.offsetWidth, h: el.offsetHeight };
  const r = rectOf(info);
  return { w: r.width, h: r.height };
}

/** World border box of an element (untransformed size around its visual centre when transformed). */
export function placeElement(cap: Capture, ctx: Ctx, info: ElInfo): Placement {
  if (!ctx.linear) return { box: toWorld(cap, ctx, rectOf(info)) };
  const size = layoutSize(info);
  return placeLocal(cap, ctx, info, { x: 0, y: 0, w: size.w, h: size.h });
}

/** World placement of the border box shrunk by insets (top, right, bottom, left), e.g. the content box. */
export function placeInset(
  cap: Capture,
  ctx: Ctx,
  info: ElInfo,
  insets: readonly [number, number, number, number],
): Placement {
  const [t, r, b, l] = insets;
  if (!ctx.linear) return { box: inset(toWorld(cap, ctx, rectOf(info)), t, r, b, l) };
  const size = layoutSize(info);
  return placeLocal(cap, ctx, info, { x: l, y: t, w: Math.max(0, size.w - l - r), h: Math.max(0, size.h - t - b) });
}

/**
 * World placement of `local`, a rectangle in the element's own untransformed border-box
 * coordinates. With an accumulated transform the box keeps its local size and the linear part
 * of the transform is returned for `Layer.transform` (applied around the box centre).
 */
export function placeLocal(cap: Capture, ctx: Ctx, info: ElInfo, local: Rect): Placement {
  const world = toWorld(cap, ctx, rectOf(info));
  const m = ctx.linear;
  if (!m) {
    return { box: { x: world.x + local.x, y: world.y + local.y, w: local.w, h: local.h } };
  }
  const size = layoutSize(info);
  const cx = world.x + world.w / 2;
  const cy = world.y + world.h / 2;
  const ox = local.x + local.w / 2 - size.w / 2;
  const oy = local.y + local.h / 2 - size.h / 2;
  const px = cx + m[0] * ox + m[2] * oy;
  const py = cy + m[1] * ox + m[3] * oy;
  return { box: { x: px - local.w / 2, y: py - local.h / 2, w: local.w, h: local.h }, transform: linearToCss(m) };
}
