import { RealtimeClock } from "../clock";
import type {
  BuiltinPlugin,
  ChoreoHelpers,
  Controls,
  CreateControlsFn,
  CreateI18nFn,
  CreateSoundFn,
  CreateStageFn,
  ResolveThemeFn,
  SoundEngine,
  Stage,
} from "../internal";
import type { Clock, Player, PlayerOptions, Plugin, SoundOptions } from "../types";
import { Engine, type EngineSettings } from "./engine";
import {
  checkBlueprint,
  checkSpeed,
  DEFAULT_SEED,
  type FinaleMode,
  type FollowMode,
  isFinaleMode,
  isFollowMode,
  resolveLabels,
  resolveSound,
} from "./options";
import { streamRng } from "./streams";

/**
 * The other zones a player is assembled from. `createPlayer` (../player.ts) binds them to the
 * real theme, stage, sound, toolbar, i18n and choreography modules; tests pass fakes.
 */
export interface PlayerZones {
  resolveTheme: ResolveThemeFn;
  createStage: CreateStageFn;
  createSound: CreateSoundFn;
  createControls: CreateControlsFn;
  createI18n: CreateI18nFn;
  /** Built-in choreographies; `PlayerOptions.plugins` follow it and override its task keys. */
  builtinPlugin: BuiltinPlugin;
  choreo: ChoreoHelpers;
}

function matches(query: string): boolean {
  try {
    return typeof globalThis.matchMedia === "function" && globalThis.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function isClock(v: unknown): v is Clock {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<Clock>;
  return (
    typeof c.now === "function" &&
    typeof c.onTick === "function" &&
    typeof c.start === "function" &&
    typeof c.stop === "function"
  );
}

/** A clock that only moves when told to: frames depend on its steps, not on the machine. */
function isManualClock(clock: Clock): boolean {
  return typeof (clock as { advance?: unknown }).advance === "function";
}

function checkPlugins(plugins: unknown): Plugin[] {
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins)) throw new TypeError("plugins must be an array");
  return plugins.map((p: unknown, i) => {
    if (typeof p !== "object" || p === null || typeof (p as Plugin).name !== "string") {
      throw new TypeError(`plugins[${i}] must be an object with a name`);
    }
    return p as Plugin;
  });
}

function pick<T>(value: unknown, valid: (v: unknown) => v is T, fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (!valid(value)) throw new RangeError(`invalid ${name}: ${String(value)}`);
  return value;
}

function resolveSettings(options: PlayerOptions): EngineSettings {
  const seed = options.seed ?? DEFAULT_SEED;
  if (typeof seed !== "number" || !Number.isFinite(seed))
    throw new RangeError(`seed must be a finite number, got ${seed}`);
  const reduced = options.reducedMotion ?? "auto";
  if (reduced !== "auto" && typeof reduced !== "boolean")
    throw new RangeError('reducedMotion must be "auto" or a boolean');
  return {
    agents: options.agents ?? "auto",
    speed: checkSpeed(options.speed ?? 1),
    seed: seed >>> 0,
    labels: resolveLabels(options.labels),
    follow: pick<FollowMode>(options.follow, isFollowMode, "scroll", "follow"),
    finale: pick<FinaleMode>(options.finale, isFinaleMode, "flock", "finale"),
    intro: options.intro !== false,
    reducedMotion: reduced === "auto" ? matches("(prefers-reduced-motion: reduce)") : reduced,
  };
}

function resolveHost(options: PlayerOptions, mode: "overlay" | "inline"): HTMLElement {
  if (options.host !== undefined) {
    if (typeof HTMLElement === "undefined" || !(options.host instanceof HTMLElement)) {
      throw new TypeError("host must be an HTMLElement");
    }
    return options.host;
  }
  if (mode === "inline") throw new TypeError('mode "inline" needs a host element');
  const body = typeof document === "undefined" ? null : document.body;
  if (!body) throw new TypeError("overlay mode needs a document with a body");
  return body;
}

/**
 * Validates `options` and assembles a player from `zones`: resolveTheme -> createStage ->
 * createSound -> createControls (unless `controls` is false) -> {@link Engine}.
 *
 * All option validation happens before any zone is called, so bad options mount nothing.
 * When a zone throws later, everything created so far is released before the error propagates.
 *
 * @param options Blueprint plus playback, theme, sound and plugin settings.
 * @param zones The zone factories to assemble the player from.
 * @returns The engine, which implements {@link Player}.
 * @throws TypeError for a malformed blueprint, host, clock or plugin list; RangeError for
 *   out-of-range options; any error a zone factory throws.
 */
export function assemblePlayer(options: PlayerOptions, zones: PlayerZones): Player {
  if (typeof options !== "object" || options === null) throw new TypeError("createPlayer() needs an options object");
  const { blueprint } = options;
  checkBlueprint(blueprint);
  const settings = resolveSettings(options);
  const mode = options.mode ?? (options.host ? "inline" : "overlay");
  if (mode !== "overlay" && mode !== "inline") throw new RangeError(`mode must be "overlay" or "inline", got ${mode}`);
  const host = resolveHost(options, mode);
  if (options.clock !== undefined && !isClock(options.clock)) throw new TypeError("clock must implement Clock");
  const plugins: Plugin[] = [zones.builtinPlugin, ...checkPlugins(options.plugins)];
  const soundOptions: SoundOptions & { seed: number } = { ...resolveSound(options.sound), seed: settings.seed };
  const clock = options.clock ?? new RealtimeClock();
  const initialScroll = mode === "overlay" && typeof window !== "undefined" ? window.scrollY || 0 : 0;
  const scrubber = options.scrubber ?? false;
  if (typeof scrubber !== "boolean") throw new TypeError("scrubber must be a boolean");
  const theme = zones.resolveTheme(options.theme, blueprint, matches("(prefers-color-scheme: dark)"));

  let stage: Stage | null = null;
  let sound: SoundEngine | null = null;
  let engine: Engine | null = null;
  try {
    stage = zones.createStage({
      blueprint,
      mode,
      host,
      theme,
      plugins,
      reducedMotion: settings.reducedMotion,
      initialScroll,
      rng: streamRng(settings.seed, "stage"),
    });
    const soundEngine = zones.createSound(soundOptions);
    sound = soundEngine;
    const i18n = zones.createI18n(options.locale);
    const player = new Engine({
      stage,
      sound: soundEngine,
      clock,
      ownsClock: options.clock === undefined,
      plugins,
      estimate: zones.choreo.estimate,
      theme,
      translate: (key) => i18n.t(key),
      settings,
      liveLevels: !isManualClock(clock),
      initialScroll,
      onLive: options.onLive,
    });
    engine = player;
    if (options.controls !== false) {
      const controls: Controls = zones.createControls({
        host: stage.uiLayer,
        player,
        i18n,
        chrome: theme.chrome,
        soundLocked: () => soundEngine.locked,
        onUnlockSound: () => {
          soundEngine.unlock().catch((error: unknown) => player.report(error));
        },
        settings: () => player.settings(),
        onClose: () => {
          player.destroy();
          options.onClose?.();
        },
        focus: () => player.focus(),
        reducedMotion: settings.reducedMotion,
        ...(scrubber ? { timeline: () => player.timeline() } : {}),
      });
      player.addCleanup(() => controls.destroy());
    }
    return player;
  } catch (error) {
    // The engine owns stage and sound once it exists; before that, release them directly.
    if (engine) engine.destroy();
    else {
      sound?.destroy();
      stage?.destroy();
    }
    throw error;
  }
}
