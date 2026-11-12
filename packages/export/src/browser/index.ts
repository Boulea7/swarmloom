/**
 * @swarmloom/export/browser: deterministic video export inside the page (WebCodecs + Mediabunny),
 * frame for frame the same as `swarmloom render`. Load it lazily; it pulls in the muxer.
 */

export { base64ToBytes, bytesToBase64 } from "../base64";
export {
  CHANNELS,
  type CodecProbe,
  type EncodingPlan,
  hasWebCodecs,
  planEncoding,
  SAMPLE_RATE,
  UnsupportedExportError,
  VideoFileWriter,
  webCodecsProbe,
} from "./encode";
export {
  type BrowserExportOptions,
  type BrowserExportResult,
  type ExportProgress,
  type ExportSettings,
  exportVideo,
} from "./exporter";
export { FRAME_ATTRIBUTE, isExportFrame } from "./marker";
export { type FontWatch, type WatchedFace, watchFontFaces } from "./raster/fonts";
export { FrameRasterizer, type RasterizerOptions } from "./raster/rasterize";
export type { Box, CanvasMark, CanvasOverlay, FrameSnapshot, ScrollMark, SnapshotStats } from "./raster/snapshot";
export {
  type FrameDriver,
  type FrameProgress,
  type FrameScheduleOptions,
  type FrameScheduleResult,
  frameMicros,
  frameTime,
  runFrameSchedule,
  yieldTask,
} from "./schedule";
