/**
 * @swarmloom/export: frame-exact export on a virtual clock, offline WAV soundtracks and the
 * headless render page protocol driven by the CLI (`dist/render/`).
 */

export { renderAudioWav } from "./audio";
export { base64ToBytes, bytesToBase64 } from "./base64";
export { exportFrames, type FrameExportOptions, type FrameExportResult } from "./frames";
export { createRenderApi, type RenderDeps } from "./render/api";
export {
  type ParsedInit,
  parseInit,
  type RenderApi,
  type RenderInit,
  type RenderInput,
  type RenderStep,
} from "./render/protocol";
export { MAX_STEP_MS, RenderSession, type RenderSessionOptions, type SessionStatus } from "./session";
