import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * Markdown (GFM) -> themed HTML in a hidden sandbox -> snapshot-dom.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const markdownAdapter: Adapter = {
  id: "markdown",
  label: "Markdown",
  extensions: ["md", "markdown", "mdown", "mkd"],
  mime: ["text/markdown", "text/x-markdown"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default markdownAdapter;
