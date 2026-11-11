import { LIMITS } from "../constants";
import { LottieError } from "../errors";
import { finite, formatBytes, isRecord, parseJson } from "./json";
import { collectKeyTimes, normalizeTimes } from "./keytimes";
import type { LottieInfo, LottieStats, ParsedLottie, ParseLottieOptions } from "./model";

type Json = Record<string, unknown>;

/** Layer types lottie-web's light SVG renderer draws: precomp, solid, image, null, shape, text. */
const VISUAL_TYPES = new Set([0, 1, 2, 3, 4, 5]);
/** Audio (6) and data (15) layers: never played, and data layers would fetch their source. */
const DROPPED_TYPES = new Map([
  [6, "audio"],
  [15, "data"],
]);
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml)[;,]/i;
/** 1x1 transparent PNG used in place of images that cannot be embedded. */
export const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function required(data: Json, key: string): number {
  const v = data[key];
  if (!finite(v))
    throw new LottieError("invalid", `This JSON is not a Lottie animation: "${key}" is missing or not a number.`);
  return v;
}

function readInfo(data: Json): LottieInfo {
  if (typeof data.v !== "string" || !/^\d+\.\d+/.test(data.v)) {
    throw new LottieError("invalid", 'This JSON is not a Lottie animation: the version ("v") is missing.');
  }
  if (!Array.isArray(data.layers)) {
    throw new LottieError("invalid", 'This JSON is not a Lottie animation: "layers" is missing.');
  }
  const fr = required(data, "fr");
  const ip = required(data, "ip");
  const op = required(data, "op");
  const w = required(data, "w");
  const h = required(data, "h");
  if (fr <= 0 || fr > LIMITS.maxFrameRate) {
    throw new LottieError("invalid", `The frame rate ${fr} fps is outside 0-${LIMITS.maxFrameRate} fps.`);
  }
  if (!(op > ip)) throw new LottieError("invalid", `The out point (${op}) must come after the in point (${ip}).`);
  if (!(w > 0 && h > 0) || w > LIMITS.maxSide || h > LIMITS.maxSide) {
    throw new LottieError("invalid", `The composition size ${w} x ${h} is outside 1-${LIMITS.maxSide} px.`);
  }
  const frames = op - ip;
  const seconds = frames / fr;
  if (seconds > LIMITS.maxDurationSeconds) {
    throw new LottieError(
      "too-large",
      `The animation lasts ${Math.round(seconds)} s (the limit is ${LIMITS.maxDurationSeconds} s).`,
    );
  }
  const info: LottieInfo = { version: data.v, fr, ip, op, w, h, frames, duration: (frames / fr) * 1000 };
  if (typeof data.nm === "string" && data.nm.trim()) info.name = data.nm.trim().slice(0, 200);
  return info;
}

/** Removes expressions (`x` strings next to a property value `k`) everywhere; returns how many. */
function stripExpressions(root: unknown): number {
  let removed = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "object" && item !== null) stack.push(item);
      continue;
    }
    if (!isRecord(v)) continue;
    if (typeof v.x === "string" && "k" in v) {
      delete v.x;
      removed++;
    }
    for (const key in v) {
      const child = v[key];
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
  return removed;
}

type ResolvedOptions = Required<Omit<ParseLottieOptions, "resolveImage">> & Pick<ParseLottieOptions, "resolveImage">;

interface SanitizeState {
  opts: ResolvedOptions;
  notes: Set<string>;
  stats: LottieStats;
  images: Set<string>;
  precomps: Map<string, unknown[]>;
}

function sanitizeAssets(data: Json, state: SanitizeState): void {
  if (data.assets === undefined) return;
  if (!Array.isArray(data.assets)) throw new LottieError("invalid", '"assets" must be a list.');
  const kept: unknown[] = [];
  let external = 0;
  let footage = 0;
  for (const asset of data.assets) {
    if (!isRecord(asset) || (typeof asset.id !== "string" && typeof asset.id !== "number")) continue;
    const id = String(asset.id);
    if (Array.isArray(asset.layers)) {
      state.precomps.set(id, asset.layers);
      state.stats.precomps++;
      kept.push(asset);
      continue;
    }
    if (typeof asset.p !== "string") continue;
    // Footage (t: 3, JSON data sources) and audio are loaded by XHR or never drawn.
    if (asset.t === 3 || /^data:audio\//i.test(asset.p) || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(asset.p)) {
      footage++;
      continue;
    }
    let src = asset.p;
    let embedded = asset.e === 1 || src.startsWith("data:");
    const path = `${typeof asset.u === "string" ? asset.u : ""}${src}`;
    const resolved = embedded ? undefined : state.opts.resolveImage?.(path);
    if (resolved !== undefined) {
      src = resolved;
      embedded = true;
    }
    if (embedded && EMBEDDED_IMAGE.test(src)) {
      if (src.length > state.opts.maxImageBytes * 1.37) {
        throw new LottieError("too-large", `Image "${id}" is larger than ${formatBytes(state.opts.maxImageBytes)}.`);
      }
    } else {
      external++;
      src = BLANK_PNG;
    }
    asset.u = "";
    asset.p = src;
    asset.e = 1;
    state.images.add(id);
    state.stats.images++;
    kept.push(asset);
  }
  data.assets = kept;
  if (external > 0) state.notes.add(`${external} image(s) are not embedded in the file and were left out.`);
  if (footage > 0) state.notes.add(`${footage} audio or data asset(s) were removed.`);
}

function sanitizeFonts(data: Json, state: SanitizeState): void {
  const list = isRecord(data.fonts) && Array.isArray(data.fonts.list) ? data.fonts.list : null;
  if (!list) return;
  let replaced = 0;
  for (const font of list) {
    if (!isRecord(font)) continue;
    if (typeof font.fFamily === "string") font.fFamily = font.fFamily.replace(/[^\w\s,'"-]/g, "").slice(0, 200);
    // Web fonts would be fetched from fPath (<link>, <script> or @font-face, even with an empty path);
    // fall back to locally installed fonts.
    const remote =
      (typeof font.fPath === "string" && font.fPath !== "") ||
      (font.origin !== undefined && font.origin !== 0) ||
      (font.fOrigin !== undefined && font.fOrigin !== "n");
    if (remote) {
      font.fPath = "";
      font.origin = 0;
      font.fOrigin = "n";
      replaced++;
    }
  }
  if (replaced > 0) state.notes.add(`${replaced} web font(s) were replaced by locally installed fonts.`);
}

/**
 * Text animators with "randomize order" (`s.rn: 1`) shuffle letters with `Math.random` in
 * lottie-web, so two plays (or a play and its export) would differ. They get the fixed order.
 */
function fixTextOrder(layer: Json, state: SanitizeState): void {
  const animators = isRecord(layer.t) && Array.isArray(layer.t.a) ? layer.t.a : [];
  let fixed = 0;
  for (const animator of animators) {
    if (isRecord(animator) && isRecord(animator.s) && animator.s.rn === 1) {
      animator.s.rn = 0;
      fixed++;
    }
  }
  if (fixed > 0) state.notes.add("Text animators with a random letter order play in a fixed order.");
}

/** Validates one layer list in place; drops audio/data layers. */
function sanitizeLayers(list: unknown[], where: string, state: SanitizeState): unknown[] {
  const kept: unknown[] = [];
  for (const layer of list) {
    if (!isRecord(layer) || !finite(layer.ty) || !Number.isInteger(layer.ty)) {
      throw new LottieError("invalid", `A layer in ${where} has no valid type ("ty").`);
    }
    if (++state.stats.layers > state.opts.maxLottieLayers) {
      throw new LottieError("too-large", `The animation has more than ${state.opts.maxLottieLayers} layers.`);
    }
    const dropped = DROPPED_TYPES.get(layer.ty);
    if (dropped) {
      state.notes.add(`${dropped[0]?.toUpperCase()}${dropped.slice(1)} layers are not played.`);
      continue;
    }
    if (VISUAL_TYPES.has(layer.ty) && !isRecord(layer.ks)) {
      throw new LottieError(
        "invalid",
        `Layer "${String(layer.nm ?? layer.ind ?? "?")}" in ${where} has no transform ("ks").`,
      );
    }
    if (!finite(layer.ip) || !finite(layer.op)) {
      throw new LottieError(
        "invalid",
        `Layer "${String(layer.nm ?? layer.ind ?? "?")}" in ${where} has no in/out point.`,
      );
    }
    if (layer.ty === 0 && (typeof layer.refId !== "string" || !state.precomps.has(layer.refId))) {
      throw new LottieError("invalid", `Precomposition layer "${String(layer.nm ?? "?")}" points to a missing asset.`);
    }
    if (layer.ty === 2 && (typeof layer.refId !== "string" || !state.images.has(layer.refId))) {
      throw new LottieError("invalid", `Image layer "${String(layer.nm ?? "?")}" points to a missing image.`);
    }
    if (layer.ty === 5) {
      state.stats.texts++;
      fixTextOrder(layer, state);
    }
    if (layer.shapes !== undefined && !Array.isArray(layer.shapes)) {
      throw new LottieError("invalid", `Shape layer "${String(layer.nm ?? "?")}" has malformed shapes.`);
    }
    // After Effects layer names and classes become element ids and classes; keep the stage clean.
    delete layer.ln;
    delete layer.cl;
    kept.push(layer);
  }
  return kept;
}

function resolveOptions(opts: ParseLottieOptions): ResolvedOptions {
  const out: ResolvedOptions = {
    maxBytes: opts.maxBytes ?? LIMITS.maxBytes,
    maxDepth: opts.maxDepth ?? LIMITS.maxDepth,
    maxLottieLayers: opts.maxLottieLayers ?? LIMITS.maxLottieLayers,
    maxKeyframes: opts.maxKeyframes ?? LIMITS.maxKeyframes,
    maxImageBytes: opts.maxImageBytes ?? LIMITS.maxImageBytes,
  };
  if (opts.resolveImage) out.resolveImage = opts.resolveImage;
  return out;
}

/**
 * Validates and sanitises Lottie JSON for playback without expressions, scripts or network:
 *
 *  - structure: version, frame rate, in/out points, size, layers with types, transforms and
 *    in/out points, resolvable precomposition and image references, no precomposition cycles;
 *  - limits: size, nesting depth, layer and keyframe counts, duration, embedded image size;
 *  - expressions are removed (the light player never evaluates them); an animation whose motion
 *    comes only from expressions is rejected, because it would not move at all;
 *  - images must be embedded (data:image/*); audio, data/footage layers and web fonts are removed;
 *  - text animators with a random letter order get the fixed order (lottie-web would shuffle with
 *    `Math.random`, so plays and exports would differ);
 *  - After Effects layer ids/classes (`ln`, `cl`) are dropped.
 *
 * @throws LottieError with a user-facing message when the input is rejected.
 */
export function parseLottie(text: string, options: ParseLottieOptions = {}): ParsedLottie {
  const opts = resolveOptions(options);
  const data = parseJson(text, opts, "Lottie file");
  if (!isRecord(data)) throw new LottieError("invalid", "This JSON is not a Lottie animation.");
  const info = readInfo(data);
  const state: SanitizeState = {
    opts,
    notes: new Set(),
    stats: { layers: 0, precomps: 0, images: 0, texts: 0, keyframes: 0, expressions: 0 },
    images: new Set(),
    precomps: new Map(),
  };
  sanitizeAssets(data, state);
  sanitizeFonts(data, state);
  for (const [id, layers] of state.precomps) {
    const kept = sanitizeLayers(layers, `precomposition "${id}"`, state);
    const asset = (data.assets as Json[]).find((a) => String(a.id) === id);
    if (asset) asset.layers = kept;
    state.precomps.set(id, kept);
  }
  data.layers = sanitizeLayers(data.layers as unknown[], "the composition", state);
  if ((data.layers as unknown[]).length === 0) throw new LottieError("invalid", "The animation has no visible layers.");

  state.stats.expressions = stripExpressions(data);
  const times = collectKeyTimes(data.layers as unknown[], state.precomps, {
    maxKeyframes: opts.maxKeyframes,
    maxVisits: opts.maxLottieLayers * 4,
  });
  state.stats.keyframes = times.count;
  if (state.stats.expressions > 0) {
    if (times.count === 0) {
      throw new LottieError(
        "unsupported",
        `This animation moves only through After Effects expressions (${state.stats.expressions} found). ` +
          "SwarmLoom never runs expressions, so nothing would move. Bake the expressions into keyframes " +
          "(After Effects: Animation > Keyframe Assistant > Convert Expression to Keyframes) and export again.",
      );
    }
    state.notes.add(
      `${state.stats.expressions} expression(s) were ignored; their properties keep their keyframed values.`,
    );
  }
  const keyTimes = normalizeTimes(times.keyframes, info.ip, info.op);
  return {
    info,
    json: JSON.stringify(data),
    keyTimes: keyTimes.length > 0 ? keyTimes : normalizeTimes(times.bounds, info.ip, info.op),
    stats: state.stats,
    notes: [...state.notes],
  };
}
