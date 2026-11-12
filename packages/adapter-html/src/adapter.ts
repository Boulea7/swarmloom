import {
  type LoadedText,
  loadSnapshotDom,
  readSource,
  type SnapshotDom,
  type SourceText,
  type TextAdapter,
} from "@swarmloom/adapter-code";
import type { AdapterContext, Blueprint, BlueprintSource, Plugin, SourceInput } from "@swarmloom/core";
import { decodeHtml, isFullDocument } from "./detect";
import { renderInFrame } from "./frame";
import { applyNetworkPolicy, localOrigin, type NetworkPolicy } from "./policy";
import { prepareDocument } from "./prepare";
import { sanitizeFragment } from "./sanitize";
import { findTimelinePlugin, type KeyframeTimeline, timelineLayers } from "./timeline";

/** Options of {@link createHtmlAdapter}. */
export interface HtmlAdapterOptions {
  /** Reject sources larger than this many bytes. Default 8 MiB. */
  maxBytes?: number;
  /**
   * Remote subresources: "https" (default) loads https: images and fonts without a referrer;
   * "none" loads nothing from the network. Scripts never run and nothing else is fetched.
   * A host can narrow this per load with {@link HtmlLoadContext.network}.
   */
  network?: NetworkPolicy;
  /** Reject documents with more elements than this. Default 60 000. */
  maxElements?: number;
  /** Frame viewport height for full documents (affects `vh` units and fixed elements). Default from the width, 600..1080. */
  viewportHeight?: number;
  /** Wait at most this long for the document and its subresources. Default 10 000 ms. */
  loadTimeoutMs?: number;
  /** Extra wait after load before animations are frozen. Default 120 ms. */
  settleMs?: number;
  /** Pose of infinite CSS animations, as a fraction of one cycle. Default 0.5. */
  infinitePhase?: number;
  /**
   * Keep the capture frame of a full document after loading and return it as
   * {@link LoadedHtml.live}, so a host can show the real page on go live with its animations
   * running again. The frame stays hidden until the host moves it; `dispose()` removes it.
   * Default false (the frame is removed right after the snapshot).
   */
  keepLive?: boolean;
  /** Base URL for relative assets. Default: the input URL. */
  baseUrl?: string;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshot?: SnapshotDom;
}

/**
 * Adapter context plus the host's network policy for this load (Studio sets it from its
 * "Load web images and fonts" setting). Core's `AdapterContext` does not declare the member.
 */
export interface HtmlLoadContext extends AdapterContext {
  network?: NetworkPolicy;
  /**
   * Plugins the host registers with its player. When one is named `anim:timeline` (from
   * @swarmloom/adapter-lottie, looked up by name, not imported), animated elements of a full
   * document also get a keyframe timeline before their animations play again; otherwise nothing
   * changes.
   */
  plugins?: readonly Plugin[];
}

/** The live page behind a capture (see {@link HtmlAdapterOptions.keepLive}). */
export interface LiveFrame {
  /** The hidden, sandboxed frame holding the page (scripts off, CSP applied). */
  frame: HTMLIFrameElement;
  document: Document;
  /** Lets the animations frozen for the capture play again (call on go live). */
  resume(): void;
}

/** What the HTML adapter returns: {@link LoadedText} plus the live frame when it was kept. */
export interface LoadedHtml extends LoadedText {
  live?: LiveFrame;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;
const DEFAULT_SETTLE_MS = 120;
const MIN_WIDTH = 320;
const MAX_WIDTH = 2560;

const FRAGMENT_PAGE = {
  light: { page: "#FFFFFF", ink: "#16161F" },
  dark: { page: "#0E0E16", ink: "#E7E7F1" },
};

function checkPolicy(network: unknown, where: string): asserts network is NetworkPolicy | undefined {
  if (network !== undefined && network !== "https" && network !== "none")
    throw new TypeError(`html: unknown ${where} ${JSON.stringify(network)}`);
}

function checkContext(ctx: HtmlLoadContext): void {
  if (!ctx || typeof ctx !== "object" || !ctx.document)
    throw new TypeError("html: AdapterContext with a document is required");
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`html: ctx.width must be positive, got ${ctx.width}`);
  if (ctx.theme !== "light" && ctx.theme !== "dark") throw new TypeError(`html: ctx.theme must be "light" or "dark"`);
  checkPolicy(ctx.network, "ctx.network policy");
  if (ctx.plugins !== undefined && !Array.isArray(ctx.plugins))
    throw new TypeError("html: ctx.plugins must be an array");
}

function positive(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`html: ${name} must be a non-negative number, got ${value}`);
  return value;
}

/** Our own intro icon: an indigo tile with angle brackets. */
function htmlIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<path d="M24 22 13 32l11 10M40 22l11 10-11 10" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="32" cy="32" r="4" fill="#FF6B5B"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function sourceOf(src: SourceText, title: string | undefined): BlueprintSource {
  const t = title?.trim() || src.name;
  return {
    type: "html",
    ...(src.name ? { name: src.name } : {}),
    ...(t ? { title: t } : {}),
    ...(src.url && /^(?:https?|file):/i.test(src.url) ? { url: src.url } : {}),
  };
}

function finish(blueprint: Blueprint, source: BlueprintSource, scheme: "light" | "dark"): Blueprint {
  blueprint.source = { ...blueprint.source, ...source };
  blueprint.icon ??= htmlIcon();
  blueprint.scheme ??= scheme;
  return blueprint;
}

/** Base URL usable inside the frame: only absolute http(s)/file URLs. */
function usableBase(url: string | undefined): string | undefined {
  return url && /^(?:https?|file):/i.test(url) ? url : undefined;
}

/**
 * Creates the HTML adapter. Full documents are sanitized and laid out in a hidden sandboxed frame
 * (no scripts, CSP limited to https images and fonts by default, finite CSS animations at their
 * end state and loops at a fixed phase) and snapshotted with origin "document"; fragments are
 * sanitized and laid out by snapshotHtml.
 */
export function createHtmlAdapter(options: HtmlAdapterOptions = {}): TextAdapter<LoadedHtml> {
  checkPolicy(options.network, "network policy");
  const configured = options.network ?? "https";
  return {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm", "xhtml"],
    mime: ["text/html", "application/xhtml+xml"],
    async load(input: SourceInput, ctx: HtmlLoadContext): Promise<LoadedHtml> {
      checkContext(ctx);
      // The stricter policy wins: a host's "none" turns remote loading off for this load.
      const network: NetworkPolicy = ctx.network === "none" ? "none" : configured;
      const timelinePlugin = findTimelinePlugin(ctx.plugins);
      ctx.signal?.throwIfAborted();
      const win = ctx.document.defaultView;
      if (!win) throw new Error("html: ctx.document must belong to a window");
      const src = await readSource(input, {
        adapter: "html",
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
        decode: decodeHtml,
      });
      const baseUrl = usableBase(options.baseUrl ?? src.url);
      const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ctx.width)));
      const snap = options.snapshot ?? (await loadSnapshotDom());
      const warnings: string[] = [];

      if (!isFullDocument(src.text)) {
        const colors = FRAGMENT_PAGE[ctx.theme];
        const tpl = ctx.document.createElement("template");
        tpl.innerHTML = sanitizeFragment(src.text, win);
        const refused = applyNetworkPolicy(tpl.content, network, baseUrl, localOrigin(baseUrl));
        if (refused > 0) warnings.push(refusedNote(refused, network));
        const html = `<div class="swarmloom-fragment">${tpl.innerHTML}</div>`;
        const css =
          `.swarmloom-fragment{box-sizing:border-box;padding:32px;background:${colors.page};color:${colors.ink};` +
          "font:16px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif}" +
          ".swarmloom-fragment img{max-width:100%;height:auto}";
        const source = sourceOf(src, undefined);
        const blueprint = await snap.snapshotHtml(html, {
          width,
          css,
          document: ctx.document,
          baseUrl,
          background: colors.page,
          scheme: ctx.theme,
          icon: htmlIcon(),
          source,
          maxLayers: ctx.maxLayers,
          signal: ctx.signal,
        });
        return { blueprint: finish(blueprint, source, ctx.theme), warnings };
      }

      const prepared = prepareDocument(src.text, win, { baseUrl, network, maxElements: options.maxElements });
      if (prepared.hadScripts)
        warnings.push("html: the page has scripts; it is shown as written, without running them");
      if (prepared.refused > 0) warnings.push(refusedNote(prepared.refused, network));
      const height = Math.round(
        positive("viewportHeight", options.viewportHeight, Math.min(1080, Math.max(600, width * 0.625))),
      );
      const loadTimeoutMs = positive("loadTimeoutMs", options.loadTimeoutMs, DEFAULT_LOAD_TIMEOUT_MS);
      const frame = await renderInFrame({
        host: ctx.document,
        html: prepared.html,
        width,
        height: Math.max(200, height),
        loadTimeoutMs,
        settleMs: positive("settleMs", options.settleMs, DEFAULT_SETTLE_MS),
        infinitePhase: options.infinitePhase,
        keyframes: timelinePlugin !== undefined,
        signal: ctx.signal,
      });
      let kept = false;
      try {
        if (!frame.loaded) warnings.push(`html: some resources did not load within ${loadTimeoutMs} ms`);
        const source = sourceOf(src, prepared.title);
        const blueprint = await snap.snapshot(frame.doc, {
          origin: "document",
          source,
          maxLayers: ctx.maxLayers,
          inlineImages: true,
          signal: ctx.signal,
        });
        const result: LoadedHtml = { blueprint: finish(blueprint, source, ctx.theme), warnings };
        if (timelinePlugin && frame.timelines) addTimelines(result, timelinePlugin, frame.timelines, ctx.maxLayers);
        if (options.keepLive) {
          kept = true;
          result.live = { frame: frame.frame, document: frame.doc, resume: () => frame.frozen.resume() };
          result.dispose = frame.dispose;
        }
        return result;
      } finally {
        if (!kept) frame.dispose();
      }
    },
  };
}

/** Appends the timeline layers that fit the layer budget and lists the plugin the blueprint now needs. */
function addTimelines(
  result: LoadedHtml,
  plugin: Plugin,
  timelines: readonly KeyframeTimeline[],
  maxLayers: number | undefined,
): void {
  const { blueprint } = result;
  const room = maxLayers === undefined ? timelines.length : Math.floor(maxLayers) - blueprint.layers.length;
  const layers = timelineLayers(timelines.slice(0, Math.max(0, room)), blueprint.layers, blueprint.size);
  if (layers.length === 0) return;
  blueprint.layers.push(...layers);
  blueprint.plugins = [...(blueprint.plugins ?? []), plugin.name];
  result.plugins = [...(result.plugins ?? []), plugin];
}

function refusedNote(count: number, network: NetworkPolicy): string {
  const what = network === "none" ? "remote resources are off" : "only https images and fonts are loaded";
  return `html: ${count} resource reference${count === 1 ? "" : "s"} skipped (${what})`;
}

/** HTML adapter with default options (id "html"). */
export const htmlAdapter: TextAdapter<LoadedHtml> = createHtmlAdapter();
