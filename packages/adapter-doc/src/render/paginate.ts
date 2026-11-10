import type { DocBlock, DocParagraph, DocRun, DocSection } from "../model";

/** The content of one sheet. Sheets come only from explicit breaks and section starts, never from overflow. */
export interface PageContent {
  section: DocSection;
  /** First sheet of its section (selects the "first page" header when the section asks for one). */
  firstOfSection: boolean;
  blocks: DocBlock[];
}

function isBlank(runs: readonly DocRun[]): boolean {
  return runs.every((r) => r.kind === "text" && r.text.trim() === "");
}

/** Splits a paragraph at its explicit page-break runs. */
function splitAtBreaks(p: DocParagraph): DocParagraph[] {
  if (!p.runs.some((r) => r.kind === "page-break")) return [p];
  const parts: DocParagraph[] = [];
  let runs: DocRun[] = [];
  for (const run of p.runs) {
    if (run.kind === "page-break") {
      parts.push({ ...p, runs });
      runs = [];
    } else {
      runs.push(run);
    }
  }
  parts.push({ ...p, runs });
  // Only the first fragment keeps the list marker and the space before.
  return parts.map((part, i) => (i === 0 ? part : { ...part, marker: undefined, markerFollow: undefined }));
}

/**
 * Distributes section blocks over sheets: a new sheet starts at every non-continuous section, at
 * paragraphs with "page break before" and at explicit page breaks. Fragments left empty by a break are dropped.
 */
export function paginate(sections: readonly DocSection[]): PageContent[] {
  const pages: PageContent[] = [];
  const open = (section: DocSection, firstOfSection: boolean): PageContent => {
    const page: PageContent = { section, firstOfSection, blocks: [] };
    pages.push(page);
    return page;
  };
  for (const section of sections) {
    const last = pages.at(-1);
    let page = last && section.props.breakCode === 0 ? last : open(section, true);
    for (const block of section.blocks) {
      if (block.kind === "table") {
        page.blocks.push(block);
        continue;
      }
      if (block.props.pageBreakBefore && page.blocks.length > 0) page = open(section, false);
      const parts = splitAtBreaks(block);
      for (const [j, part] of parts.entries()) {
        if (j > 0) page = open(section, false);
        const blank = isBlank(part.runs) && !part.marker;
        if (blank && parts.length > 1) continue;
        page.blocks.push(part);
      }
    }
  }
  return pages;
}
