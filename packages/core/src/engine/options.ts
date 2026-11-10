import type { Blueprint, LabelMode, PlayerOptions, SoundOptions } from "../types";
import { AUTO_MAX_AGENTS, AUTO_MIN_AGENTS, BASE_SHARE, MAX_AGENTS, REFERENCE_AREA } from "./constants";
import { clamp } from "./easing";

export type FollowMode = "scroll" | "tour" | "none";
export type FinaleMode = "flock" | "halo" | "none";

const FOLLOW_MODES: readonly FollowMode[] = ["scroll", "tour", "none"];
const FINALE_MODES: readonly FinaleMode[] = ["flock", "halo", "none"];
const LABEL_MODES: readonly LabelMode[] = ["names", "agents", "roles", "none"];
/** Accepted speed range; outside it the build is unwatchable or numerically fragile. */
export const MIN_SPEED = 0.05;
export const MAX_SPEED = 20;
export const DEFAULT_SEED = 1;

export function isFollowMode(v: unknown): v is FollowMode {
  return FOLLOW_MODES.includes(v as FollowMode);
}

export function isFinaleMode(v: unknown): v is FinaleMode {
  return FINALE_MODES.includes(v as FinaleMode);
}

/**
 * Validates a speed multiplier.
 * @throws RangeError when not a finite number > 0. Values are clamped to [MIN_SPEED, MAX_SPEED].
 */
export function checkSpeed(speed: unknown): number {
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) {
    throw new RangeError(`speed must be a finite number > 0, got ${String(speed)}`);
  }
  return clamp(speed, MIN_SPEED, MAX_SPEED);
}

/**
 * Throws a TypeError when the blueprint is structurally unusable. Individual malformed layers
 * are tolerated (the planner skips and reports them).
 */
export function checkBlueprint(blueprint: unknown): asserts blueprint is Blueprint {
  if (typeof blueprint !== "object" || blueprint === null) throw new TypeError("blueprint must be an object");
  const bp = blueprint as Partial<Blueprint>;
  if (bp.version !== 1) throw new TypeError(`unsupported blueprint version ${String(bp.version)}`);
  if (!Array.isArray(bp.layers)) throw new TypeError("blueprint.layers must be an array");
  const size = bp.size;
  if (!size || !(Number.isFinite(size.w) && size.w > 0) || !(Number.isFinite(size.h) && size.h > 0)) {
    throw new TypeError("blueprint.size must have finite positive w and h");
  }
}

/**
 * Number of cursors for `agents: "auto"`: grows with the square root of the layer count
 * (work to share) and of the viewport area (room to move), clamped to 8..64.
 * A 61-layer page at 1280x800 gets 23; 263 layers get 42; a phone viewport about two thirds.
 */
export function autoAgentCount(layerCount: number, viewportArea: number): number {
  const area = Number.isFinite(viewportArea) && viewportArea > 0 ? viewportArea : REFERENCE_AREA;
  const areaFactor = clamp(Math.sqrt(area / REFERENCE_AREA), 0.5, 1.6);
  const byLayers = 6 + 2.2 * Math.sqrt(Math.max(0, layerCount));
  return Math.round(clamp(byLayers * areaFactor, AUTO_MIN_AGENTS, AUTO_MAX_AGENTS));
}

/** Resolves PlayerOptions.agents to a pool size in 1..MAX_AGENTS. */
export function resolveAgentCount(agents: PlayerOptions["agents"], layerCount: number, viewportArea: number): number {
  if (agents === undefined || agents === "auto") return autoAgentCount(layerCount, viewportArea);
  if (typeof agents !== "number" || !Number.isFinite(agents)) {
    throw new RangeError(`agents must be "auto" or a finite number, got ${String(agents)}`);
  }
  return Math.round(clamp(agents, 1, MAX_AGENTS));
}

/** Agents active from the start (the rest joins when there is work); never leave while building. */
export function baseCrew(total: number): number {
  return clamp(Math.round(total * BASE_SHARE), Math.min(total, 4), total);
}

/** Validates PlayerOptions.labels. */
export function resolveLabels(labels: PlayerOptions["labels"]): LabelMode | readonly string[] {
  if (labels === undefined) return "names";
  if (Array.isArray(labels)) return labels.filter((l): l is string => typeof l === "string");
  if (LABEL_MODES.includes(labels as LabelMode)) return labels as LabelMode;
  throw new RangeError(`labels must be one of ${LABEL_MODES.join(", ")} or a list of strings`);
}

/** Normalizes PlayerOptions.sound (default: enabled). */
export function resolveSound(sound: PlayerOptions["sound"]): SoundOptions {
  if (sound === undefined || sound === true) return { enabled: true };
  if (sound === false) return { enabled: false };
  if (typeof sound === "object" && sound !== null) return { ...sound, enabled: sound.enabled !== false };
  throw new TypeError("sound must be a boolean or SoundOptions");
}
