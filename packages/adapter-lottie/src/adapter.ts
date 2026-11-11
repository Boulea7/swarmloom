import { createSvgAdapter } from "@swarmloom/adapter-svg";
import type { Adapter, AdapterContext, Blueprint, LoadedSource, Plugin, SourceInput } from "@swarmloom/core";
import { assembleLayers, layoutFor } from "./blueprint";
import { LIMITS, LOTTIE_ADAPTER_ID, LOTTIE_PLUGIN } from "./constants";
import { resolveArchiveImage, unpackDotLottie } from "./dotlottie";
import { LottieError, throwIfAborted } from "./errors";
import { readLottieSource } from "./input";
import type { LottieInfo, ParsedLottie } from "./lottie/model";
import { parseLottie } from "./lottie/validate";
import { createLottiePlugin } from "./player/plugin";
import { candidateFrames, choosePose, fixedPose, type PoseChoice, type ScoredFrame, visibleArea } from "./render/pose";
import { loadRuntime } from "./render/runtime";
import { renderLottie } from "./render/sandbox";
import { mergeLetters, snapshotMarkup } from "./render/snapshot";
import { sniffLottie } from "./sniff";
import { TIMELINE_PLUGIN } from "./timeline/data";
import { createAnimTimelinePlugin } from "./timeline/plugin";

/** Options of {@link createLottieAdapter}. */
export interface LottieAdapterOptions {
  /**
   * Frame woven as the static pose: "auto" (default: the settled last frame of intro-style files,
   * otherwise the frame showing the most), "first", "last" or a composition frame number.
   */
  pose?: PoseChoice;
  /** Playback after the weave: true loops, false plays once, n plays n times. Default: the dotLottie manifest, else true. */
  loop?: boolean | number;
  /** Animation id inside a .lottie holding several. Default: the manifest's active animation. */
  animationId?: string;
  /** Largest Lottie JSON accepted, bytes (default 50 MiB). */
  maxBytes?: number;
  /** Most blueprint layers, including the player and timeline (default 1500; `AdapterContext.maxLayers` can lower it). */
  maxLayers?: number;
}

/** What the Lottie adapter returns: the loaded source plus quality notes and the composition facts. */
export interface LottieLoadedSource extends LoadedSource {
  /** Plain-English notes about removed or approximated features; may be empty. */
  notes: string[];
  info: LottieInfo;
}

/** Longest side of the off-screen render used to pick the pose, px (scores are relative). */
const SANDBOX_SIDE = 1024;
/** Layers the adapter adds to the woven pose (player and timeline). */
const OWN_LAYERS = 2;
/** Converts the chosen frame, already laid out in world space, at exactly the world width. */
const frameAdapter = createSvgAdapter({ fit: "width" });

interface Animation {
  parsed: ParsedLottie;
  loop?: boolean | number;
  speed?: number;
  notes: string[];
}

async function readAnimation(input: SourceInput, opts: LottieAdapterOptions, signal?: AbortSignal): Promise<Animation> {
  const maxBytes = opts.maxBytes ?? LIMITS.maxBytes;
  const source = await readLottieSource(input, { maxBytes, maxArchiveBytes: LIMITS.maxArchiveBytes }, signal);
  throwIfAborted(signal);
  if (source.kind === "json") return { parsed: parseLottie(source.text, { maxBytes }), notes: [] };
  const unpackOptions = opts.animationId ? { animationId: opts.animationId, maxBytes } : { maxBytes };
  const content = await unpackDotLottie(source.bytes, unpackOptions);
  throwIfAborted(signal);
  const parsed = parseLottie(content.animation, {
    maxBytes,
    resolveImage: (path) => resolveArchiveImage(content.images, path),
  });
  const out: Animation = { parsed, notes: content.notes };
  if (content.loop !== undefined) out.loop = content.loop;
  if (content.speed !== undefined) out.speed = content.speed;
  return out;
}

/** Renders the animation off-screen, picks the pose and returns it as SVG markup in world space. */
function snapshotPose(
  parsed: ParsedLottie,
  choice: PoseChoice,
  doc: Document,
  runtime: Awaited<ReturnType<typeof loadRuntime>>,
  layout: ReturnType<typeof layoutFor>,
): { rest: number; markup: string } {
  const { info } = parsed;
  const count = Math.max(1, Math.floor(info.op - info.ip));
  const fit = Math.min(1, SANDBOX_SIDE / Math.max(info.w, info.h));
  const rendered = renderLottie(runtime, doc, parsed.json, { w: info.w * fit, h: info.h * fit });
  try {
    let rest = fixedPose(choice, info.ip, count);
    if (rest === null) {
      const keys = new Set(parsed.keyTimes.map((t) => Math.round(t - info.ip)));
      const scored: ScoredFrame[] = candidateFrames(
        [...keys].sort((a, b) => a - b),
        count,
      ).map((index) => {
        rendered.show(index);
        return { index, score: visibleArea(rendered.svg), key: keys.has(index) };
      });
      rest = choosePose(scored, count - 1);
    }
    rendered.show(rest);
    mergeLetters(rendered.svg);
    return {
      rest,
      markup: snapshotMarkup(rendered.svg, { w: info.w, h: info.h }, { world: layout.world, rect: layout.comp }),
    };
  } finally {
    rendered.dispose();
  }
}

function validateContext(ctx: AdapterContext): void {
  if (!ctx?.document) throw new TypeError("Lottie adapter: ctx.document is required");
  if (!(Number.isFinite(ctx.width) && ctx.width > 0)) throw new RangeError("Lottie adapter: ctx.width must be > 0");
  if (ctx.maxLayers !== undefined && !(ctx.maxLayers > OWN_LAYERS)) {
    throw new RangeError(`Lottie adapter: ctx.maxLayers must be > ${OWN_LAYERS}`);
  }
}

/**
 * Creates the Lottie adapter. Input: Lottie JSON (Bodymovin) or a dotLottie archive (v1 or v2).
 *
 *  1. The animation is validated and sanitised (`parseLottie`): no expressions, remote assets,
 *     web fonts, audio or data layers reach the renderer; sizes, depth and counts are limited.
 *  2. lottie-web's light SVG renderer (loaded on first use) draws it off-screen; one frame is
 *     chosen as the static pose and converted by the SVG adapter: shapes become path layers with
 *     their fills and strokes, text becomes typed text (one layer per line), images become image
 *     layers. Layers are clipped to the composition; a full-canvas solid becomes the background.
 *  3. Two custom layers finish the blueprint: `lottie:player` over the composition and an
 *     `anim:timeline` bar under it. After the weave, one agent drags out the timeline, drops the
 *     keyframes, scrubs the playhead, and the real animation then plays from the engine clock.
 *     With reduced motion the woven pose stays.
 *
 * The returned plugins (`svg` when definitions are used, `lottie`, `anim:timeline`) give every
 * player its own instance (`Plugin.perPlayer`), so one loaded source can drive several players.
 */
export function createLottieAdapter(options: LottieAdapterOptions = {}): Adapter {
  const maxLayers = options.maxLayers ?? LIMITS.maxLayers;
  if (!(Number.isInteger(maxLayers) && maxLayers > OWN_LAYERS)) {
    throw new RangeError(`LottieAdapterOptions.maxLayers must be an integer > ${OWN_LAYERS}`);
  }
  if (options.maxBytes !== undefined && !(options.maxBytes >= 1)) {
    throw new RangeError("LottieAdapterOptions.maxBytes must be >= 1");
  }
  const loop = options.loop;
  if (loop !== undefined && typeof loop !== "boolean" && !(Number.isInteger(loop) && loop >= 1)) {
    throw new RangeError("LottieAdapterOptions.loop must be a boolean or an integer >= 1");
  }

  return {
    id: LOTTIE_ADAPTER_ID,
    label: "Lottie animation",
    extensions: ["lottie"],
    mime: ["application/json+lottie", "application/zip+dotlottie"],
    sniff: sniffLottie,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LottieLoadedSource> {
      if (!input || typeof input !== "object") throw new TypeError("Lottie adapter: input must be an object");
      validateContext(ctx);
      const { signal } = ctx;
      throwIfAborted(signal);

      const animation = await readAnimation(input, options, signal);
      const { parsed } = animation;
      const runtime = await loadRuntime();
      throwIfAborted(signal);

      const { info } = parsed;
      const layout = layoutFor({ w: info.w, h: info.h }, ctx.width);
      const { rest, markup } = snapshotPose(parsed, options.pose ?? "auto", ctx.document, runtime, layout);
      if (markup.length > LIMITS.maxFrameChars) {
        throw new LottieError("too-large", "The chosen frame of this animation is too complex to rebuild.");
      }

      const limit = Math.min(maxLayers, ctx.maxLayers ?? maxLayers) - OWN_LAYERS;
      const woven = await frameAdapter.load(
        { text: markup, name: input.name },
        { document: ctx.document, width: layout.world.w, theme: ctx.theme, maxLayers: limit, signal },
      );
      const { layers, background, scheme } = assembleLayers({
        woven: woven.blueprint.layers,
        layout,
        info,
        json: parsed.json,
        rest,
        keyTimes: parsed.keyTimes,
        loop: loop ?? animation.loop ?? true,
        speed: animation.speed ?? 1,
      });

      const plugins: Plugin[] = [...(woven.plugins ?? []), createLottiePlugin(), createAnimTimelinePlugin()];
      const blueprint: Blueprint = {
        version: 1,
        source: { type: LOTTIE_ADAPTER_ID, name: input.name, url: input.url, title: info.name },
        size: layout.world,
        background,
        scheme,
        layers,
        plugins: [...(woven.blueprint.plugins ?? []), LOTTIE_PLUGIN, TIMELINE_PLUGIN],
      };
      if (woven.blueprint.css) blueprint.css = woven.blueprint.css;
      if (woven.blueprint.icon) blueprint.icon = woven.blueprint.icon;
      if (woven.blueprint.truncated) blueprint.truncated = woven.blueprint.truncated;
      const loaded: LottieLoadedSource = {
        blueprint,
        plugins,
        notes: [...animation.notes, ...parsed.notes],
        info,
      };
      if (woven.dispose) loaded.dispose = woven.dispose;
      return loaded;
    },
  };
}

/** The Lottie adapter with default options. */
export const lottieAdapter: Adapter = createLottieAdapter();
