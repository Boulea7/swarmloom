import { builtinPlugin, choreoHelpers } from "./choreo/index";
import { assemblePlayer, type PlayerZones } from "./engine/assemble";
import { createI18n } from "./i18n/index";
import { createSound } from "./sound/index";
import { createStage } from "./stage/index";
import { resolveTheme } from "./theme";
import type { Player, PlayerOptions } from "./types";
import { createControls } from "./ui/index";

const zones: PlayerZones = {
  resolveTheme,
  createStage,
  createSound,
  createControls,
  createI18n,
  builtinPlugin,
  choreo: choreoHelpers,
};

/**
 * Creates a player that rebuilds `options.blueprint` with a swarm of cursors.
 *
 * Wiring: resolveTheme -> createStage -> createSound -> createControls (unless `controls` is
 * false) -> engine. Built-in choreographies come first; `options.plugins` follow in order and
 * override their task keys. The player starts idle; call `play()` to run the intro and build.
 * Without a `clock` it uses its own `RealtimeClock`; pass a `VirtualClock` for
 * frame-exact export (live audio levels are then ignored, so the halo stays deterministic).
 * All randomness derives from `options.seed`: the same seed, options, viewport and clock
 * steps reproduce the same frames and the same `soundLog`.
 *
 * @param options Blueprint plus playback, theme, sound and plugin settings.
 * @returns A {@link Player} controlling playback (it also implements the optional
 *   `time`, `finish`, `seek` and `setFinale` members).
 * @throws TypeError for a malformed blueprint, host, clock or plugin list; RangeError for
 *   out-of-range options. Nothing stays mounted when it throws.
 */
export function createPlayer(options: PlayerOptions): Player {
  return assemblePlayer(options, zones);
}
