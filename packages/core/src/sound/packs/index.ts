import type { SoundPack } from "../voice";
import { chip } from "./chip";
import { soft } from "./soft";
import { studio, studioMusic } from "./studio";

/** "silent-keys": only the musical events of "studio" (notes and phrase marks), no keyboard or mouse. */
const silentKeys: SoundPack = { id: "silent-keys", voices: { ...studioMusic } };

const PACKS: ReadonlyMap<string, SoundPack> = new Map([studio, soft, chip, silentKeys].map((pack) => [pack.id, pack]));

/** Pack used when options name none or an unknown one. */
export const DEFAULT_PACK = "studio";

/** Ids of the built-in sound packs. */
export const PACK_IDS: readonly string[] = [...PACKS.keys()];

/**
 * Looks up a built-in pack. Unknown or missing ids fall back to {@link DEFAULT_PACK} so a stale
 * setting never silences playback.
 */
export function resolvePack(id: string | undefined): SoundPack {
  return (id !== undefined && PACKS.get(id)) || studio;
}
