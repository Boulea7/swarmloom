/**
 * @swarmloom/adapter-image: raster images rebuilt as a pencil sketch of their edges, painted in
 * quadtree tiles and finished with the exact picture.
 */
export { createImageAdapter, type ImageAdapterOptions, imageAdapter, imageAdapter as default } from "./adapter";
export { type Analysis, type AnalyzeOptions, createKernel, type Kernel, type Stroke, type Tile } from "./kernel";
export { smoothPath } from "./layers";
export { type ImageFormat, type ImageProbe, probeImage, sniffFormat } from "./source";
