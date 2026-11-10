import type { Player, PlayerOptions } from "./types";

/**
 * Creates a player that rebuilds `options.blueprint` with a swarm of cursors.
 *
 * The returned player starts idle; call `play()` to run the intro and build. Without an explicit
 * `clock` it uses a {@link RealtimeClock}; pass a `VirtualClock` for frame-exact export.
 * All randomness derives from `options.seed`, so the same seed and clock reproduce the same
 * frames and the same `soundLog`.
 *
 * @param options Blueprint plus playback, theme, sound and plugin settings.
 * @returns A {@link Player} controlling playback.
 * @throws Error "not implemented yet" until the engine lands.
 */
export function createPlayer(options: PlayerOptions): Player {
  void options;
  throw new Error("not implemented yet");
}
