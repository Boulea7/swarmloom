import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * HTML string or URL -> sandboxed iframe -> snapshot-dom.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const htmlAdapter: Adapter = {
  id: "html",
  label: "HTML",
  extensions: ["html", "htm", "xhtml"],
  mime: ["text/html", "application/xhtml+xml"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default htmlAdapter;
