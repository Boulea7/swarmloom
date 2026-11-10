import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * PDF (pdf.js) -> page bitmaps plus text/image/path items -> region-by-region reveal.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const pdfAdapter: Adapter = {
  id: "pdf",
  label: "PDF",
  extensions: ["pdf"],
  mime: ["application/pdf"],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default pdfAdapter;
