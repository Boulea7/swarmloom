/**
 * @swarmloom/adapter-pdf: PDF -> blueprint of page sheets whose text lines, figures and
 * rules are revealed from one pdf.js bitmap per page (pixel-exact final frame).
 *
 * pdfjs-dist is imported on the first load only, together with its worker.
 */

import { createPdfAdapter } from "./adapter";

export { configurePdfAdapter, createPdfAdapter, PDF_ICON } from "./adapter";
export { PdfAdapterError, type PdfErrorCode } from "./errors";
export type { PdfAdapterOptions } from "./options";

/** The shared PDF adapter with default options (configure it with {@link configurePdfAdapter}). */
export const pdfAdapter = createPdfAdapter();

export default pdfAdapter;
