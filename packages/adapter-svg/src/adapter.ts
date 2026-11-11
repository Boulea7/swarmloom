import type {
  Adapter,
  AdapterContext,
  Blueprint,
  CustomLayer,
  Layer,
  LoadedSource,
  Plugin,
  Rect,
  Size,
  SourceInput,
} from "@swarmloom/core";
import { convertSvg } from "./convert";
import { formatNumber } from "./path/geometry";
import { createSvgPlugin, DEFS_TASK, type SvgDefsData, svgPlugin } from "./plugin";
import { mountSandbox, type Sandbox } from "./sandbox";
import { createReport, sanitizeSvgTree } from "./sanitize";
import { hasSmil, SMIL_TASK, type SvgSmilData, stripSmil } from "./smil";
import { looksLikeSvg, readSvgText } from "./source";
import { computedStyle, isTransparent, luminance } from "./style";
import { collectSmilTimeline, findTimelinePlugin, TIMELINE_BAND, timelineLayer } from "./timeline";
import { intrinsicSize, parseViewBox, SVG_NS, stageSize, XLINK_NS } from "./units";
import { assignKeys, expandUses } from "./use";

/** Limits and tuning of the SVG adapter. */
export interface SvgAdapterOptions {
  /** Maximum emitted layers, including the definitions layer (default 4000). `AdapterContext.maxLayers` can lower it. */
  maxLayers?: number;
  /** Maximum source size in bytes (default 16 MiB). */
  maxBytes?: number;
  /** Maximum number of elements after sanitising (default 50 000); larger documents are rejected. */
  maxElements?: number;
  /** Maximum pen anchors kept per path in `meta.anchors` (default 32). */
  anchorsPerPath?: number;
  /** Maximum time spent waiting for web fonts and embedded images, ms (default 1500). */
  assetTimeout?: number;
  /**
   * Clock of the SMIL replay once the stage goes live: "own" (default) lets the drawing run on its
   * own clock, "player" keeps it on player time (frame-exact exports, whose clock keeps ticking).
   */
  liveClock?: "own" | "player";
}

/**
 * Adapter context plus the plugins the host registers with its player. Core's `AdapterContext`
 * does not declare the member, so hosts pass it through `@swarmloom/formats` `load()` unchanged.
 */
export interface SvgLoadContext extends AdapterContext {
  /**
   * When one is named `anim:timeline` (from @swarmloom/adapter-lottie, looked up by name), an
   * animated drawing also gets a keyframe timeline in a band under it before its animation plays;
   * otherwise nothing changes.
   */
  plugins?: readonly Plugin[];
}

/** Size used by browsers for an SVG that declares neither a size nor a viewBox. */
const DEFAULT_SIZE: Size = { w: 300, h: 150 };
/** The original document is used as the intro icon when its sanitised markup is at most this long. */
const MAX_ICON_CHARS = 48 * 1024;
/** Embedded images whose size has to be measured before layout. */
const MAX_MEASURED_IMAGES = 200;

let loads = 0;

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Resolves after `promise` settles or `ms` elapse, whichever comes first; never rejects. */
function settle(promise: Promise<unknown>, ms: number, view: Window | null): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = (view ?? globalThis).setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

function parseSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    const detail = (error.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new SyntaxError(`Invalid SVG markup${detail ? `: ${detail}` : ""}`);
  }
  const root = doc.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
    throw new TypeError("Not an SVG document: the root element must be <svg> in the SVG namespace");
  }
  return root as unknown as SVGSVGElement;
}

function titleOf(root: Element): string | undefined {
  for (const child of Array.from(root.children)) {
    if (child.localName === "title") {
      const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      return t ? t.slice(0, 200) : undefined;
    }
  }
  return undefined;
}

/** `@font-face` rules of the document's style sheets (already sanitised), for the stage. */
function fontFaces(root: Element): string {
  const rules: string[] = [];
  for (const style of Array.from(root.getElementsByTagNameNS(SVG_NS, "style"))) {
    for (const m of (style.textContent ?? "").matchAll(/@font-face\s*\{[^}]*\}/gi)) rules.push(m[0]);
  }
  return rules.join("\n");
}

/**
 * Gives `<image>` elements without an explicit width or height their natural size (SVG 2
 * `auto` sizing), so layout and the converter agree on their geometry.
 */
async function resolveImageSizes(root: Element, doc: Document, timeout: number): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, "image")).slice(0, MAX_MEASURED_IMAGES)) {
    const w = el.getAttribute("width");
    const h = el.getAttribute("height");
    const autoW = w === null || w.trim() === "auto";
    const autoH = h === null || h.trim() === "auto";
    const href = el.getAttribute("href") ?? el.getAttributeNS(XLINK_NS, "href");
    if (!(autoW || autoH) || !href) continue;
    const img = doc.createElement("img");
    img.src = href;
    pending.push(
      img.decode().then(() => {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!(nw > 0 && nh > 0)) return;
        if (autoW && autoH) {
          el.setAttribute("width", String(nw));
          el.setAttribute("height", String(nh));
        } else if (autoW) {
          el.setAttribute("width", formatNumber((Number.parseFloat(h ?? "0") * nw) / nh, 3));
        } else {
          el.setAttribute("height", formatNumber((Number.parseFloat(w ?? "0") * nh) / nw, 3));
        }
      }),
    );
  }
  if (pending.length > 0) await settle(Promise.allSettled(pending), timeout, doc.defaultView);
}

/** Serialises the animated copy of the drawing at the world size (the `svg:smil` layer markup). */
function liveMarkup(live: Element, vb: Rect, world: Size): string {
  live.setAttribute("viewBox", [vb.x, vb.y, vb.w, vb.h].map((v) => formatNumber(v, 6)).join(" "));
  live.setAttribute("width", String(world.w));
  live.setAttribute("height", String(world.h));
  live.removeAttribute("x");
  live.removeAttribute("y");
  return new XMLSerializer().serializeToString(live);
}

function maxOf(layers: readonly Layer[], pick: (l: Layer) => number | undefined): number {
  let max = 0;
  for (const l of layers) max = Math.max(max, pick(l) ?? 0);
  return max;
}

/** True when a layer references a definition (paint server, clip, mask, filter or marker) by fragment. */
function usesDefinitions(layer: Layer): boolean {
  // Only path layers point into the definitions: text and images with effects become snapshots.
  if (layer.kind !== "path") return false;
  return [layer.fill, layer.stroke, ...Object.values(layer.attrs ?? {})].some((v) => v?.includes("url(#"));
}

/** Detects a full-bleed solid rectangle at the bottom of the paint order and turns it into the background. */
function takeBackground(layers: Layer[], world: Size): string | null {
  const first = layers[0];
  if (first?.kind !== "path" || first.stroke || first.attrs || first.opacity !== undefined) return null;
  if (first.meta?.tag !== "rect" || first.clip || !first.fill || first.fill.startsWith("url(")) return null;
  const b: Rect = first.box;
  const covers = b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= world.w - 0.5 && b.y + b.h >= world.h - 0.5;
  if (!covers || isTransparent(first.fill)) return null;
  // A master must stay a layer: its duplicates are built from it.
  if (layers.some((l) => l.master === first.id)) return null;
  layers.shift();
  return first.fill;
}

/**
 * Creates an SVG adapter. The SVG is parsed with `DOMParser`, sanitised (no scripts, event
 * handlers, `foreignObject` or external references), laid out in an invisible sandbox in
 * `ctx.document`, and converted into stage layers scaled to `ctx.width` (see {@link stageSize}):
 * - shapes and paths become path layers in stage coordinates; stroked ones are drawn with the pen
 *   (`meta.anchors` holds the pen anchors), filled outlines are traced and then filled;
 * - gradients, patterns, clip paths, masks, filters and markers are rewritten into stage space and
 *   rendered by the `svg:defs` custom layer of {@link svgPlugin} (returned in `plugins`);
 * - text becomes typed text layers, `<image>` becomes image layers;
 * - paint order is kept (`z` and `priority` follow the document);
 * - SMIL animation (decision C04) is woven in its authored pose; an `svg:smil` layer built last
 *   fades in the sanitised animated drawing and plays it from 0 s, preceded by a keyframe
 *   timeline when the host registers an `anim:timeline` plugin ({@link SvgLoadContext.plugins}).
 * Content left out because of limits or because it was unsafe is reported in `truncated`.
 */
export function createSvgAdapter(options: SvgAdapterOptions = {}): Adapter {
  const maxLayers = options.maxLayers ?? 4000;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const maxElements = options.maxElements ?? 50_000;
  const anchorsPerPath = options.anchorsPerPath ?? 32;
  const assetTimeout = options.assetTimeout ?? 1500;
  for (const [name, v] of Object.entries({ maxLayers, maxBytes, maxElements, anchorsPerPath, assetTimeout })) {
    if (!(Number.isFinite(v) && v >= 1)) throw new RangeError(`SvgAdapterOptions.${name} must be a number >= 1`);
  }
  if (options.liveClock !== undefined && options.liveClock !== "own" && options.liveClock !== "player") {
    throw new TypeError('SvgAdapterOptions.liveClock must be "own" or "player"');
  }

  return {
    id: "svg",
    label: "SVG",
    extensions: ["svg"],
    mime: ["image/svg+xml"],
    sniff(head: Uint8Array): boolean {
      return looksLikeSvg(head);
    },
    async load(input: SourceInput, ctx: SvgLoadContext): Promise<LoadedSource> {
      if (!input || typeof input !== "object") throw new TypeError("SVG adapter: input must be an object");
      if (!ctx?.document) throw new TypeError("SVG adapter: ctx.document is required");
      if (!(Number.isFinite(ctx.width) && ctx.width > 0)) throw new RangeError("SVG adapter: ctx.width must be > 0");
      if (ctx.maxLayers !== undefined && !(ctx.maxLayers >= 1))
        throw new RangeError("SVG adapter: ctx.maxLayers must be >= 1");
      if (ctx.plugins !== undefined && !Array.isArray(ctx.plugins))
        throw new TypeError("SVG adapter: ctx.plugins must be an array");
      const { signal } = ctx;
      checkAbort(signal);

      const text = await readSvgText(input, maxBytes, signal);
      checkAbort(signal);
      const parsed = parseSvg(text);
      const report = createReport();
      sanitizeSvgTree(parsed, report);
      const elements = parsed.getElementsByTagName("*").length;
      if (elements > maxElements) {
        throw new RangeError(`SVG has too many elements (${elements}, limit ${maxElements})`);
      }
      // SMIL (C04): the weave uses the authored, un-animated drawing; an animated copy replays after it.
      const live = hasSmil(parsed) ? (parsed.cloneNode(true) as Element) : null;
      if (live) stripSmil(parsed);
      const serialized = new XMLSerializer().serializeToString(parsed);
      const icon =
        serialized.length <= MAX_ICON_CHARS
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`
          : undefined;
      const title = titleOf(parsed);
      assignKeys(parsed);
      const uses = expandUses(parsed);

      const doc = ctx.document;
      const svg = doc.importNode(parsed, true) as unknown as SVGSVGElement;
      let viewBox = parseViewBox(svg.getAttribute("viewBox"));
      let intrinsic = intrinsicSize(svg.getAttribute("width"), svg.getAttribute("height"), viewBox);
      svg.removeAttribute("x");
      svg.removeAttribute("y");

      let sandbox: Sandbox | null = null;
      try {
        if (!intrinsic) {
          // No size and no viewBox: fit the drawing's own bounds.
          sandbox = mountSandbox(doc, svg, { w: ctx.width, h: ctx.width / 2 });
          const b = svg.getBBox();
          sandbox.dispose();
          sandbox = null;
          viewBox = b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
          intrinsic = viewBox ? { w: viewBox.w, h: viewBox.h } : DEFAULT_SIZE;
        }
        const world = stageSize(intrinsic, ctx.width);
        const vb = viewBox ?? { x: 0, y: 0, w: intrinsic.w, h: intrinsic.h };
        svg.setAttribute("viewBox", [vb.x, vb.y, vb.w, vb.h].map((v) => formatNumber(v, 6)).join(" "));
        svg.setAttribute("width", String(world.w));
        svg.setAttribute("height", String(world.h));

        await resolveImageSizes(svg, doc, assetTimeout);
        checkAbort(signal);
        sandbox = mountSandbox(doc, svg, world);
        if (doc.fonts) await settle(doc.fonts.ready, assetTimeout, doc.defaultView);
        checkAbort(signal);

        const limit = Math.floor(Math.min(maxLayers, ctx.maxLayers ?? maxLayers));
        const idPrefix = `slsvg${(loads++).toString(36)}`;
        const result = convertSvg(sandbox.svg, {
          world,
          clientToStage: sandbox.clientToStage,
          // One spare layer: a full-bleed background rect is folded into the blueprint background.
          maxLayers: limit + 1,
          anchorsPerPath,
          idPrefix,
          signal,
        });

        const rootBg = computedStyle(sandbox.svg).backgroundColor;
        const layers = result.layers;
        const background =
          (rootBg && !isTransparent(rootBg) ? rootBg : null) ?? takeBackground(layers, world) ?? "#ffffff";
        const lum = luminance(background);
        const scheme = lum !== null && lum < 0.4 ? "dark" : "light";

        // Trim to the budget, keeping slots for the replay, the timeline and the definitions layer.
        const timelinePlugin = live && limit >= 3 ? findTimelinePlugin(ctx.plugins) : undefined;
        const timeline = timelinePlugin && live ? collectSmilTimeline(live) : null;
        const replay = live !== null && limit >= 2;
        const room = limit - (replay ? 1 : 0) - (timeline ? 1 : 0);
        let dropped = result.dropped;
        if (layers.length > room) {
          const kept = result.defs.size > 0 && layers.slice(0, room).some(usesDefinitions) ? room - 1 : room;
          dropped += layers.length - kept;
          layers.length = kept;
        }
        const plugins: Plugin[] = [];
        const z = maxOf(layers, (l) => l.z);
        const priority = maxOf(layers, (l) => l.priority);
        if (result.defs.size > 0 && layers.some(usesDefinitions)) {
          const data: SvgDefsData = { markup: result.defs.markup() };
          const defsLayer: CustomLayer = {
            id: `${idPrefix}-defs`,
            kind: "custom",
            task: DEFS_TASK,
            // Full-world box: virtualisation keeps the definitions mounted wherever the viewport is.
            box: { x: 0, y: 0, w: world.w, h: world.h },
            z: -1,
            priority: -1,
            data,
            meta: { definitions: result.defs.size },
          };
          layers.unshift(defsLayer);
        }
        if (timeline) {
          const band = { x: 0, y: world.h, w: world.w, h: TIMELINE_BAND };
          layers.push({ ...timelineLayer(`${idPrefix}-timeline`, { ...timeline, scheme }, band, priority), z: z + 2 });
        }
        if (replay && live) {
          const data: SvgSmilData = { markup: liveMarkup(live, vb, world) };
          // Last in the build (after the timeline when there is one), above every woven layer.
          const smilLayer: CustomLayer = {
            id: `${idPrefix}-smil`,
            kind: "custom",
            task: SMIL_TASK,
            box: { x: 0, y: 0, w: world.w, h: world.h },
            z: z + 1,
            priority: priority + 2,
            data,
            meta: { smil: true },
          };
          if (timeline) smilLayer.parent = `${idPrefix}-timeline`;
          layers.push(smilLayer);
        }
        const usesPlugin = layers.some((l) => l.kind === "custom" && (l.task === DEFS_TASK || l.task === SMIL_TASK));
        if (usesPlugin) plugins.push(replay ? createSvgPlugin({ liveClock: options.liveClock }) : svgPlugin);
        if (timeline && timelinePlugin) plugins.push(timelinePlugin);

        const reasons: string[] = [];
        if (dropped > 0) reasons.push(`layer limit of ${limit} reached`);
        if (uses.dropped > 0) reasons.push("cyclic, too deep or too many <use> references skipped");
        if (report.droppedContent > 0) reasons.push("unsafe or external content removed");
        const total = dropped + uses.dropped + report.droppedContent;
        const css = fontFaces(svg);

        const blueprint: Blueprint = {
          version: 1,
          source: { type: "svg", name: input.name, url: input.url, title },
          // The timeline bar gets its own band under the drawing, so it never covers the animation.
          size: timeline ? { w: world.w, h: world.h + TIMELINE_BAND } : world,
          background,
          scheme,
          layers,
        };
        if (css) blueprint.css = css;
        if (icon) blueprint.icon = icon;
        if (plugins.length > 0) blueprint.plugins = plugins.map((p) => p.name);
        if (reasons.length > 0) {
          blueprint.truncated = { reason: reasons.join("; "), dropped: total };
        }
        return plugins.length > 0 ? { blueprint, plugins } : { blueprint };
      } finally {
        sandbox?.dispose();
      }
    },
  };
}

/** The SVG adapter with default limits. */
export const svgAdapter: Adapter = createSvgAdapter();
