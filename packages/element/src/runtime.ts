import type { Player, PlayerOptions } from "@swarmloom/core";
import { type FormatEntry, formats } from "@swarmloom/formats";

/** Services `<swarm-loom>` depends on; replaceable for tests, CDN builds and custom players. */
export interface ElementRuntime {
  /** Creates the player. Default: `createPlayer` from `@swarmloom/core`, imported on first use. */
  createPlayer(options: PlayerOptions): Player | Promise<Player>;
  /** Formats used to detect and load sources. Default: the `@swarmloom/formats` registry. */
  formats: readonly FormatEntry[];
  /** Byte limit for `src` downloads and loaded inputs. Default: the formats default (50 MB). */
  maxBytes?: number;
}

/** Shared by every `<swarm-loom>` instance. Mutate through {@link configure}. */
export const runtime: ElementRuntime = {
  // Imported lazily so defining the element stays cheap; the engine loads when the first source does.
  createPlayer: async (options) => (await import("@swarmloom/core")).createPlayer(options),
  formats,
};

/**
 * Replaces runtime services for all `<swarm-loom>` elements, for example a custom format list.
 * Affects sources loaded after the call.
 */
export function configure(options: Partial<ElementRuntime>): void {
  Object.assign(runtime, options);
}
