import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * Raster image -> edge sketch -> tile-by-tile painting.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const imageAdapter: Adapter = {
  id: "image",
  label: "Image",
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"],
  mime: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default imageAdapter;
