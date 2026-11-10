import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * Legacy DOC (CFB + WordDocument stream) -> paragraphs and styles -> HTML -> snapshot-dom.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const docAdapter: Adapter = {
  id: "doc",
  label: "Word 97-2003 document",
  extensions: ["doc"],
  mime: ["application/msword"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default docAdapter;
