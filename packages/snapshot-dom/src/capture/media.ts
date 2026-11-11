import type { CSSMap, ImageLayer, MediaLayer, Rect } from "@swarmloom/core";
import { MEDIA_ATTR } from "../dom/env";
import { safeImageUrl } from "../util/html";
import { imageUrlOf } from "./image-src";
import type { Placement } from "./place";
import { type Capture, type Ctx, type ElInfo, emit, rectOf } from "./state";
import { serializeSvg, svgDataUrl } from "./svg";

/** Largest canvas/video frame copied into a data URL (pixels). */
const MAX_FRAME_PIXELS = 4_000_000;

function mediaStyle(cs: CSSStyleDeclaration): CSSMap | undefined {
  const style: CSSMap = {};
  const radius = cs.borderRadius;
  if (radius && radius !== "0px") style["border-radius"] = radius;
  const filter = cs.filter;
  if (filter && filter !== "none") style.filter = filter;
  return Object.keys(style).length > 0 ? style : undefined;
}

function fitOf(cs: CSSStyleDeclaration): ImageLayer["fit"] {
  const fit = cs.getPropertyValue("object-fit");
  if (fit === "cover") return "cover";
  if (fit === "contain" || fit === "scale-down" || fit === "none") return "contain";
  return "fill";
}

function emitImage(
  cap: Capture,
  ctx: Ctx,
  info: ElInfo,
  place: Placement,
  src: string,
  natural?: { w: number; h: number },
  alt?: string,
): string | null {
  const draft: Omit<ImageLayer, "id"> = { kind: "image", box: place.box, src, fit: fitOf(info.cs) };
  if (natural && natural.w > 0 && natural.h > 0) draft.natural = natural;
  const style = mediaStyle(info.cs);
  const position = info.cs.getPropertyValue("object-position");
  if (draft.fit !== "fill" && position && position !== "50% 50%") {
    const s = style ?? {};
    s["object-position"] = position;
    draft.style = s;
  } else if (style) {
    draft.style = style;
  }
  if (alt) draft.meta = { alt };
  if (place.transform) draft.transform = place.transform;
  return emit<ImageLayer>(cap, ctx, draft);
}

/**
 * Flags an image layer whose SVG carries SMIL animation (`meta.smil`). The stage shows such an
 * image still (core's stage/layers/still-svg.ts), so its frames never follow the browser clock.
 */
function markAnimated(cap: Capture, id: string): void {
  const layer = cap.layers[cap.layers.length - 1];
  if (layer?.id === id) layer.meta = { ...layer.meta, smil: true };
}

/** Emits a labelled placeholder, remembering it for a later screenshot crop. */
export function emitPlaceholder(
  cap: Capture,
  ctx: Ctx,
  info: ElInfo,
  place: Placement,
  label: string,
  src?: string,
): string | null {
  const draft: Omit<MediaLayer, "id"> = { kind: "media", box: place.box, label };
  if (src) draft.src = src;
  const style = mediaStyle(info.cs);
  if (style) draft.style = style;
  draft.meta = { tag: info.el.localName };
  if (place.transform) draft.transform = place.transform;
  const id = emit<MediaLayer>(cap, ctx, draft);
  if (id && !src && cap.opts.screenshot && !place.transform) {
    const r = rectOf(info);
    const view = cap.doc.defaultView;
    const fixed = ctx.inFixed;
    const sx = fixed || !view ? 0 : view.scrollX;
    const sy = fixed || !view ? 0 : view.scrollY;
    const rect: Rect = { x: r.left + sx + ctx.frameX, y: r.top + sy + ctx.frameY, w: r.width, h: r.height };
    cap.pendingShots.push({ id, rect, fixed });
  }
  return id;
}

/** Copies the pixels of a canvas or video into a PNG data URL; null when tainted, blank or too large. */
function frameOf(cap: Capture, source: HTMLCanvasElement | HTMLVideoElement, w: number, h: number): string | null {
  if (w <= 0 || h <= 0 || w * h > MAX_FRAME_PIXELS) return null;
  try {
    const probe = cap.doc.createElement("canvas");
    probe.width = 16;
    probe.height = 16;
    const p = probe.getContext("2d", { willReadFrequently: true });
    if (!p) return null;
    p.drawImage(source, 0, 0, 16, 16);
    const data = p.getImageData(0, 0, 16, 16).data;
    let alpha = 0;
    for (let i = 3; i < data.length; i += 4) alpha += data[i] ?? 0;
    // A WebGL canvas without preserveDrawingBuffer reads back fully transparent.
    if (alpha === 0) return null;
    if (source.localName === "canvas") return (source as HTMLCanvasElement).toDataURL("image/png");
    const full = cap.doc.createElement("canvas");
    full.width = w;
    full.height = h;
    const f = full.getContext("2d");
    if (!f) return null;
    f.drawImage(source, 0, 0, w, h);
    return full.toDataURL("image/jpeg", 0.85);
  } catch {
    // Cross-origin content taints the canvas: fall back to a placeholder.
    return null;
  }
}

function hostLabel(url: string, base: string, fallback: string): string {
  try {
    const host = new URL(url, base).hostname;
    return host ? `${fallback}: ${host}` : fallback;
  } catch {
    return fallback;
  }
}

/** Cross-origin or not-rebuildable frame placeholder label. */
export function frameLabel(el: Element): string {
  const title = el.getAttribute("title")?.trim();
  if (title) return title.slice(0, 80);
  const src = el.getAttribute("src") ?? "";
  return src ? hostLabel(src, el.baseURI, "Embedded page") : "Embedded page";
}

/**
 * Emits an image or media layer for a replaced element. Same-origin iframes are handled by the
 * walker (their documents are captured as part of the world); every other kind is handled here.
 */
export function emitMedia(cap: Capture, ctx: Ctx, info: ElInfo, place: Placement): void {
  const el = info.el;
  const tag = el.localName;
  const base = el.baseURI || cap.doc.baseURI;
  const forced = el.getAttribute(MEDIA_ATTR);
  if (forced !== null) {
    emitPlaceholder(cap, ctx, info, place, forced.trim().slice(0, 80) || "Media");
    return;
  }
  switch (tag) {
    case "img": {
      const img = el as HTMLImageElement;
      const src = imageUrlOf(img, base);
      const alt = img.getAttribute("alt") ?? "";
      if (src) emitImage(cap, ctx, info, place, src, { w: img.naturalWidth || 0, h: img.naturalHeight || 0 }, alt);
      else emitPlaceholder(cap, ctx, info, place, alt.trim().slice(0, 80) || "Image");
      return;
    }
    case "svg": {
      // Layout size: a rotated drawing keeps its own size and gets Layer.transform.
      const { w, h } = place.box;
      const svg = serializeSvg(el, { width: w, height: h, prefix: `sl${++cap.svgSeq}-`, base });
      if (svg) {
        const label = el.getAttribute("aria-label") ?? "";
        const natural = { w: Math.round(w), h: Math.round(h) };
        const id = emitImage(cap, ctx, info, place, svgDataUrl(svg.markup), natural, label);
        if (id && svg.animated) markAnimated(cap, id);
      } else {
        emitPlaceholder(cap, ctx, info, place, "Vector graphic");
      }
      return;
    }
    case "canvas": {
      const canvas = el as HTMLCanvasElement;
      const frame = frameOf(cap, canvas, canvas.width, canvas.height);
      if (frame) emitImage(cap, ctx, info, place, frame, { w: canvas.width, h: canvas.height });
      else emitPlaceholder(cap, ctx, info, place, el.getAttribute("aria-label")?.slice(0, 80) || "Canvas");
      return;
    }
    case "video": {
      const video = el as HTMLVideoElement;
      const frame = video.readyState >= 2 ? frameOf(cap, video, video.videoWidth, video.videoHeight) : null;
      const poster = video.getAttribute("poster");
      const src = frame ?? (poster ? safeImageUrl(poster, base) : null) ?? undefined;
      emitPlaceholder(
        cap,
        ctx,
        info,
        place,
        el.getAttribute("aria-label")?.slice(0, 80) || el.getAttribute("title")?.slice(0, 80) || "Video",
        src,
      );
      return;
    }
    case "audio":
      emitPlaceholder(cap, ctx, info, place, "Audio");
      return;
    case "iframe":
    case "frame":
      emitPlaceholder(cap, ctx, info, place, frameLabel(el));
      return;
    case "embed":
    case "object": {
      const url = el.getAttribute("src") ?? el.getAttribute("data") ?? "";
      const type = el.getAttribute("type") ?? "";
      if (type.startsWith("image/") && url) {
        const src = safeImageUrl(url, base);
        if (src) {
          emitImage(cap, ctx, info, place, src);
          return;
        }
      }
      emitPlaceholder(cap, ctx, info, place, url ? hostLabel(url, base, "Embedded content") : "Embedded content");
      return;
    }
    default:
      emitPlaceholder(cap, ctx, info, place, "Media");
  }
}
