import { deskCss } from "@swarmloom/adapter-docx/paged";

export const DESK_CLASS = "swl-doc-desk";
export const PAGE_CLASS = "swl-doc-page";

/** Style sheet for rendered DOC sheets: resets UA styles so only the document's own formatting shows. */
export function docCss(theme: "light" | "dark", width: number): string {
  const p = `.${PAGE_CLASS}`;
  return `${deskCss(`.${DESK_CLASS}`, `section.${PAGE_CLASS}`, theme, width)}
${p} { display: flex; flex-direction: column; position: relative; line-height: 1.15; white-space: pre-wrap;
  overflow-wrap: break-word; tab-size: 48px; -moz-tab-size: 48px; text-size-adjust: none; -webkit-text-size-adjust: none; }
${p} :is(h1, h2, h3, h4, h5, h6, p, li, ul) { margin: 0; padding: 0; font-size: inherit; font-weight: inherit; }
${p} ul.swl-doc-list { list-style: none; }
${p} .swl-doc-marker { display: inline-block; text-indent: 0; white-space: pre; }
${p} .swl-doc-body { flex: 1 0 auto; }
${p} .swl-doc-header, ${p} .swl-doc-footer { flex: none; display: flex; flex-direction: column; }
${p} .swl-doc-footer { justify-content: flex-end; }
${p} .swl-doc-notes { flex: none; padding-top: 6pt; }
${p} .swl-doc-notesep { border: 0; border-top: 0.75pt solid #000; width: 33%; margin: 0 0 4pt; }
${p} .swl-doc-endnotes { margin-top: 12pt; }
${p} sup, ${p} sub { font-size: 0.65em; line-height: 0; }
${p} a { color: inherit; text-decoration: inherit; }
${p} img { max-width: 100%; height: auto; vertical-align: baseline; }
${p} table.swl-doc-table { border-collapse: collapse; table-layout: fixed; max-width: 100%; }
${p} table.swl-doc-table td { vertical-align: top; padding: 0 7px; overflow-wrap: anywhere; }
${p} table.swl-doc-grid td { border: 1px solid #000; }
${p}.swl-doc-text { color: #000000; }
${p}.swl-doc-text :is(h1, h2, h3, h4, h5, h6) { font-weight: 700; }
${p}.swl-doc-text h1 { font-size: 1.6em; }
${p}.swl-doc-text h2 { font-size: 1.3em; }
${p}.swl-doc-text h3 { font-size: 1.15em; }
${p}.swl-doc-text :is(h4, h5, h6) { font-size: 1em; }
`;
}
