import type { CustomLayer } from "@swarmloom/core";
import { parseLottie } from "../lottie/validate";
import type { PlaybackTiming } from "./timing";

/** `CustomLayer.data` of the `lottie:player` layer. */
export interface LottiePlayerData {
  /** Lottie JSON text (validated and sanitised again when the player mounts). */
  json: string;
  /** Composition frame woven as the static pose; playback hands over from it. */
  rest: number;
  /** true loops forever, false plays once, n plays n times. */
  loop: boolean | number;
  /** Playback speed multiplier, 0.1-8. */
  speed: number;
  /** Solid CSS colour painted under the animation so it covers the woven pose while it plays. */
  background: string;
}

/** Everything the player needs from a validated layer. */
export interface PlayerSpec {
  json: string;
  timing: PlaybackTiming;
  /** Frame index (from the in point) of the woven pose. */
  rest: number;
  background: string;
}

/** Hex, rgb()/rgba() or `transparent`: nothing that could load a resource. */
const SOLID_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%/]+\)|transparent)$/i;

/** A CSS colour safe to put in an inline style, else "transparent". */
export function solidColor(value: unknown): string {
  return typeof value === "string" && SOLID_COLOR.test(value.trim()) ? value.trim() : "transparent";
}

function readLoop(v: unknown): boolean | number {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000) return v;
  return true;
}

/**
 * Reads a `lottie:player` layer. The animation is validated and sanitised again (a blueprint may
 * come from storage or another origin), so expressions, remote assets and web fonts never reach
 * lottie-web. Returns null when the data is unusable; the layer then draws nothing and the
 * woven pose stays.
 */
export function readPlayer(layer: CustomLayer): PlayerSpec | null {
  const data = (typeof layer.data === "object" && layer.data !== null ? layer.data : {}) as Partial<LottiePlayerData>;
  if (typeof data.json !== "string") return null;
  let parsed: ReturnType<typeof parseLottie>;
  try {
    parsed = parseLottie(data.json);
  } catch {
    return null;
  }
  const { info } = parsed;
  const speed = typeof data.speed === "number" && data.speed >= 0.1 && data.speed <= 8 ? data.speed : 1;
  const timing: PlaybackTiming = { ip: info.ip, op: info.op, fr: info.fr, speed, loop: readLoop(data.loop) };
  const last = Math.max(0, Math.floor(info.op - info.ip) - 1);
  const rest = typeof data.rest === "number" && Number.isFinite(data.rest) ? Math.round(data.rest - info.ip) : 0;
  return {
    json: parsed.json,
    timing,
    rest: Math.min(last, Math.max(0, rest)),
    background: solidColor(data.background),
  };
}
