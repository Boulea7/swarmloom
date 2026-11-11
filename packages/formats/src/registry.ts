import type { Adapter } from "@swarmloom/core";
import { createRegistry } from "./meta";

export type { FormatEntry, FormatMeta } from "./meta";

// One static import() per adapter so bundlers emit one lazy chunk per format.
const LOADERS: Record<string, () => Promise<Adapter>> = {
  dom: () => import("@swarmloom/snapshot-dom").then((m) => m.domAdapter),
  markdown: () => import("@swarmloom/adapter-markdown").then((m) => m.markdownAdapter),
  html: () => import("@swarmloom/adapter-html").then((m) => m.htmlAdapter),
  docx: () => import("@swarmloom/adapter-docx").then((m) => m.docxAdapter),
  doc: () => import("@swarmloom/adapter-doc").then((m) => m.docAdapter),
  pdf: () => import("@swarmloom/adapter-pdf").then((m) => m.pdfAdapter),
  svg: () => import("@swarmloom/adapter-svg").then((m) => m.svgAdapter),
  slides: () => import("@swarmloom/adapter-office").then((m) => m.slidesAdapter),
  sheet: () => import("@swarmloom/adapter-office").then((m) => m.sheetAdapter),
  code: () => import("@swarmloom/adapter-code").then((m) => m.codeAdapter),
  image: () => import("@swarmloom/adapter-image").then((m) => m.imageAdapter),
  three: () => import("@swarmloom/adapter-three").then((m) => m.threeAdapter),
  odf: () => import("@swarmloom/adapter-odf").then((m) => m.odfAdapter),
  epub: () => import("@swarmloom/adapter-epub").then((m) => m.epubAdapter),
  rtf: () => import("@swarmloom/adapter-rtf").then((m) => m.rtfAdapter),
  ofd: () => import("@swarmloom/adapter-ofd").then((m) => m.ofdAdapter),
  notebook: () => import("@swarmloom/adapter-notebook").then((m) => m.notebookAdapter),
  terminal: () => import("@swarmloom/adapter-terminal").then((m) => m.terminalAdapter),
  diff: () => import("@swarmloom/adapter-diff").then((m) => m.diffAdapter),
  mindmap: () => import("@swarmloom/adapter-mindmap").then((m) => m.mindmapAdapter),
  lottie: () => import("@swarmloom/adapter-lottie").then((m) => m.lottieAdapter),
};

/** Every supported format with a lazy `import()` of its adapter. */
export const formats = createRegistry((id) => {
  const loader = LOADERS[id];
  return loader ? loader() : Promise.reject(new Error(`No adapter registered for "${id}"`));
});
