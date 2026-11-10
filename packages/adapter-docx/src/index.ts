import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * DOCX -> paged HTML -> snapshot-dom.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const docxAdapter: Adapter = {
  id: "docx",
  label: "Word document",
  extensions: ["docx"],
  mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default docxAdapter;
