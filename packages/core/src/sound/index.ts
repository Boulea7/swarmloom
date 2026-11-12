/**
 * Sound zone of @swarmloom/core: realtime WebAudio synthesis, deterministic offline rendering and
 * WAV encoding. `createSound` is internal (the player wires it); `renderOffline`, `soundTimes`,
 * `encodeWav` and `quantize` are part of the public API.
 */

export type { Levels } from "./levels";
export { BAND_COUNT } from "./levels";
export type { RenderOfflineOptions } from "./offline";
export { MAX_RENDER_MS, renderOffline, soundTimes } from "./offline";
export { DEFAULT_PACK, PACK_IDS } from "./packs";
export { DEFAULT_BPM, eighthMs, quantize } from "./quantize";
export type { RealtimeSoundDeps, RealtimeSoundOptions } from "./realtime";
export { createSound } from "./realtime";
export type { PcmSource } from "./wav";
export { encodeWav } from "./wav";
