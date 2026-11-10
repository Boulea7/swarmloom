import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * SVG -> path strokes and fills, typed text.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const svgAdapter: Adapter = {
  id: "svg",
  label: "SVG",
  extensions: ["svg"],
  mime: ["image/svg+xml"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default svgAdapter;
