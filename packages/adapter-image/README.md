# @swarmloom/adapter-image

The image adapter for SwarmLoom. It accepts PNG/APNG, JPEG, GIF, WebP, AVIF and BMP (animated files use their first frame) and turns a picture into a pencil sketch that is then painted in. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { imageAdapter } from "@swarmloom/adapter-image";

const { blueprint, dispose } = await imageAdapter.load({ bytes }, { document, width: 960, theme: "light" });
// ... play the blueprint ...
dispose?.(); // releases the blob: URL of the image
```

How it works:

1. The header is checked (format, pixel count, animation) before decoding with `createImageBitmap`, which applies EXIF orientation. Rotated, animated, oversized and BMP sources are re-encoded to a still image.
2. A working copy (512 px on its longest side by default) is analysed in a Web Worker, falling back to the calling thread. The analysis converts to luma, blurs it, runs Sobel with non-maximum suppression and adaptive hysteresis, links edge pixels into polylines, simplifies them with Ramer-Douglas-Peucker and keeps the strongest strokes. The same pass builds a detail-driven quadtree of colour tiles. Both runs execute the same code and give identical results.
3. The blueprint has three acts. First, sketch strokes are smoothed path layers drawn with the pen in a pencil style (`meta.sketch: true`). Next, quadtree tiles are image layers that crop the original, biggest first, with reveal `paint` and their mean colour as a background. Finally, the full image fades in.

Options (`createImageAdapter`): `workSize`, `maxStrokes` (160), `maxTiles` (256), `minTile`, `epsilon`, `minStrokeLength`, `maxBytes` (50 MiB), `maxPixels` (64 MP), `maxDisplaySide` (4096), `maxUpscale` (2), `maxHeightRatio` (4), `worker`, `workerTimeout`, `inlineAssets` (data: URLs instead of blob: URLs). With `ctx.maxLayers` the sketch and tiles shrink to fit the budget, and `truncated` reports it. The final image always shows every pixel.

License: MIT.
