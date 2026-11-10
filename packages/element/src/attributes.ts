import type { LabelMode, PlayerOptions } from "@swarmloom/core";

/** Attributes `<swarm-loom>` reacts to. */
export const ATTRIBUTES = [
  "src",
  "type",
  "agents",
  "speed",
  "seed",
  "theme",
  "labels",
  "finale",
  "autoplay",
  "loop",
  "controls",
  "sound",
  "inview",
  "reduced-motion",
] as const;

/** One of {@link ATTRIBUTES}. */
export type AttributeName = (typeof ATTRIBUTES)[number];

/** Attributes that only take effect when the player is created; changing them rebuilds the player. */
export const PLAYER_ATTRIBUTES: ReadonlySet<string> = new Set([
  "agents",
  "seed",
  "theme",
  "labels",
  "finale",
  "controls",
  "reduced-motion",
]);

/** Parsed attribute values; absent or invalid attributes fall back to the player defaults. */
export interface ElementConfig {
  agents?: number | "auto";
  speed: number;
  seed?: number;
  theme: "auto" | "light" | "dark";
  labels?: LabelMode | string[];
  finale?: "flock" | "halo" | "none";
  controls: boolean;
  sound: boolean;
  reducedMotion: "auto" | boolean;
  autoplay: boolean;
  inview: boolean;
  /** Delay before replaying after the build completes, ms; null disables looping. */
  loop: number | null;
}

/** Upper bound for an explicit `agents` count (larger values are clamped). */
export const MAX_AGENTS = 128;
/** Replay delay in ms for a bare `loop` attribute. */
export const DEFAULT_LOOP_DELAY = 1500;
const MAX_LOOP_DELAY = 600_000;
const MIN_SPEED = 0.1;
const MAX_SPEED = 8;
const MAX_LABELS = 64;
const MAX_LABEL_LENGTH = 32;

type Read = (name: AttributeName) => string | null;

/** Boolean attribute: present means on, except for an explicit "false" / "off" / "no" / "0". */
export function parseBoolean(value: string | null): boolean {
  return value !== null && !/^(?:false|off|no|0)$/i.test(value.trim());
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v);
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `agents`: "auto" or a positive integer clamped to {@link MAX_AGENTS}; anything else is unset. */
export function parseAgents(value: string | null): number | "auto" | undefined {
  if (value?.trim().toLowerCase() === "auto") return "auto";
  const n = parseNumber(value);
  return n !== undefined && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_AGENTS) : undefined;
}

/** `speed`: a positive multiplier clamped to 0.1..8; default 1. */
export function parseSpeed(value: string | null): number {
  const n = parseNumber(value);
  return n !== undefined && n > 0 ? Math.min(Math.max(n, MIN_SPEED), MAX_SPEED) : 1;
}

/** `seed`: an integer, else unset (the player picks its default seed). */
export function parseSeed(value: string | null): number | undefined {
  const n = parseNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/** "names" | "agents" | "roles" | "none", or a comma-separated list of custom cursor names. */
export function parseLabels(value: string | null): LabelMode | string[] | undefined {
  const mode = oneOf(value, ["names", "agents", "roles", "none"] as const);
  if (mode) return mode;
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim().slice(0, MAX_LABEL_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_LABELS);
  return names.length > 0 ? names : undefined;
}

/** `loop` alone replays after {@link DEFAULT_LOOP_DELAY}; `loop="4000"` after 4 s. */
export function parseLoop(value: string | null): number | null {
  if (value === null || !parseBoolean(value)) return null;
  const n = parseNumber(value);
  return n !== undefined && n >= 0 ? Math.min(n, MAX_LOOP_DELAY) : DEFAULT_LOOP_DELAY;
}

/** `reduced-motion`: "auto" (follow the OS setting, the default) or a boolean override. */
export function parseReducedMotion(value: string | null): "auto" | boolean {
  if (value === null || value.trim().toLowerCase() === "auto") return "auto";
  return parseBoolean(value);
}

/** Reads every attribute through `read` (usually `el.getAttribute`). */
export function readConfig(read: Read): ElementConfig {
  return {
    agents: parseAgents(read("agents")),
    speed: parseSpeed(read("speed")),
    seed: parseSeed(read("seed")),
    theme: oneOf(read("theme"), ["light", "dark"] as const) ?? "auto",
    labels: parseLabels(read("labels")),
    finale: oneOf(read("finale"), ["flock", "halo", "none"] as const),
    controls: parseBoolean(read("controls")),
    sound: parseBoolean(read("sound")),
    reducedMotion: parseReducedMotion(read("reduced-motion")),
    autoplay: parseBoolean(read("autoplay")),
    inview: parseBoolean(read("inview")),
    loop: parseLoop(read("loop")),
  };
}

/** Player options for an inline player inside `host`; unset values are left to the player defaults. */
export function toPlayerOptions(
  config: ElementConfig,
  base: Pick<PlayerOptions, "blueprint" | "plugins" | "host">,
): PlayerOptions {
  const options: PlayerOptions = {
    ...base,
    mode: "inline",
    speed: config.speed,
    theme: config.theme,
    controls: config.controls,
    sound: config.sound,
    reducedMotion: config.reducedMotion,
  };
  if (config.agents !== undefined) options.agents = config.agents;
  if (config.seed !== undefined) options.seed = config.seed;
  if (config.labels !== undefined) options.labels = config.labels;
  if (config.finale !== undefined) options.finale = config.finale;
  return options;
}
