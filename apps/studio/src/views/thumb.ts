import type { ExampleEntry } from "../examples/manifest";
import { h, s } from "../ui/dom";

/**
 * Static thumbnails for example cards, built at no runtime cost: a poster image when the example
 * ships one, the file itself for images and SVG (an `<img>` never runs SVG scripts), a CSS preview
 * of the first lines for Markdown, code and CSV, and a small format illustration otherwise.
 * Untrusted text only ever goes through `textContent`.
 */

const MAX_LINES = 12;

/** URL of a file inside the examples folder. */
export function exampleUrl(base: string, path: string): string {
  return new URL(path.split("/").map(encodeURIComponent).join("/"), base).href;
}

function image(src: string, fit: "cover" | "contain"): HTMLElement {
  const img = h("img", {
    class: `thumb-img thumb-${fit}`,
    attrs: { src, alt: "", loading: "lazy", decoding: "async", draggable: "false" },
  });
  // A broken image falls back to the plain paper instead of a broken-image glyph.
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

/** Removes inline Markdown syntax for a readable preview line. */
function plainMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function markdownPreview(snippet: string): HTMLElement {
  const doc = h("div", { class: "thumb-doc" });
  let inCode = false;
  let count = 0;
  for (const raw of snippet.split("\n")) {
    if (count >= MAX_LINES) break;
    const line = raw.trimEnd();
    if (line.trimStart().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      doc.append(h("div", { class: "t-code", text: line || " " }));
      count++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      doc.append(h("div", { class: `t-h t-h${Math.min(heading[1].length, 3)}`, text: plainMarkdown(heading[2]) }));
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      doc.append(h("div", { class: "t-li", text: plainMarkdown(line.replace(/^\s*([-*+]|\d+\.)\s+/, "")) }));
    } else if (line.startsWith(">")) {
      doc.append(h("div", { class: "t-quote", text: plainMarkdown(line.replace(/^>\s?/, "")) }));
    } else if (line.trim() === "") {
      doc.append(h("div", { class: "t-gap" }));
    } else {
      doc.append(h("div", { class: "t-p", text: plainMarkdown(line) }));
    }
    count++;
  }
  return doc;
}

const CODE_TOKEN =
  /(\/\/.*$|#(?!include).*$|--.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)|\b(const|let|var|function|return|if|else|for|while|import|from|export|class|def|fn|pub|struct|type|interface|async|await|new|package|func|SELECT|FROM|WHERE)\b/g;

function codeLine(line: string): HTMLElement {
  const el = h("div", { class: "t-line" });
  let last = 0;
  for (const match of line.matchAll(CODE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) el.append(line.slice(last, index));
    const kind = match[1] ? "t-comment" : match[2] ? "t-string" : "t-keyword";
    el.append(h("span", { class: kind, text: match[0] }));
    last = index + match[0].length;
  }
  if (last < line.length) el.append(line.slice(last));
  if (line === "") el.append(" ");
  return el;
}

function codePreview(snippet: string): HTMLElement {
  const lines = snippet.split("\n").slice(0, MAX_LINES);
  return h("div", { class: "thumb-code" }, ...lines.map(codeLine));
}

function sheetPreview(snippet: string): HTMLElement {
  const rows = snippet
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, 7);
  const delimiter = (rows[0] ?? "").includes("\t") ? "\t" : ",";
  const grid = h("div", { class: "thumb-sheet" });
  rows.forEach((row, r) => {
    const cells = row.split(delimiter).slice(0, 5);
    while (cells.length < 5) cells.push("");
    for (const cell of cells) {
      grid.append(h("span", { class: r === 0 ? "t-cell t-head" : "t-cell", text: cell.replace(/^"|"$/g, "").trim() }));
    }
  });
  return grid;
}

function lines(count: number, className = "t-bar"): HTMLElement[] {
  return Array.from({ length: count }, (_, i) => h("span", { class: className, data: { i } }));
}

/** Format illustrations for binary formats without a poster. */
function illustration(format: string): HTMLElement {
  switch (format) {
    case "slides":
      return h(
        "div",
        { class: "thumb-slide" },
        h("span", { class: "t-title" }),
        h("div", { class: "t-cols" }, h("div", { class: "t-stack" }, ...lines(4)), h("span", { class: "t-figure" })),
      );
    case "html":
      return h(
        "div",
        { class: "thumb-browser" },
        h("div", { class: "t-chrome" }, h("i"), h("i"), h("i")),
        h("span", { class: "t-hero" }),
        h("div", { class: "t-stack" }, ...lines(3)),
      );
    case "three": {
      const svg = s(
        "svg",
        { viewBox: "0 0 100 100", class: "thumb-model", "aria-hidden": "true" },
        s("path", { d: "M50 14 84 33v38L50 90 16 71V33Z", class: "t-face" }),
        s("path", { d: "M16 33 50 52 84 33M50 52v38", class: "t-edge" }),
        s("path", { d: "M33 23.5 67 42.5M67 23.5 33 42.5M33 61v19M67 61v19", class: "t-wire" }),
      );
      return h("div", { class: "thumb-model-wrap" }, svg);
    }
    case "sheet":
      return sheetPreview("A,B,C,D,E\n,,,,\n,,,,\n,,,,\n,,,,");
    default:
      return h(
        "div",
        { class: "thumb-page" },
        h("span", { class: "t-title" }),
        h("div", { class: "t-stack" }, ...lines(7)),
        h("div", { class: "t-cols" }, h("span", { class: "t-figure" }), h("div", { class: "t-stack" }, ...lines(3))),
      );
  }
}

/** Builds the static thumbnail for an example card. */
export function thumbnail(entry: ExampleEntry, examplesBase: string): HTMLElement {
  const frame = h("div", { class: "thumb", data: { format: entry.format }, attrs: { "aria-hidden": "true" } });
  if (entry.poster) {
    frame.append(image(exampleUrl(examplesBase, entry.poster), "cover"));
  } else if (entry.format === "image") {
    frame.append(image(exampleUrl(examplesBase, entry.path), "cover"));
  } else if (entry.format === "svg") {
    frame.append(image(exampleUrl(examplesBase, entry.path), "contain"));
  } else if (entry.snippet && entry.format === "markdown") {
    frame.append(markdownPreview(entry.snippet));
  } else if (entry.snippet && entry.format === "code") {
    frame.append(codePreview(entry.snippet));
  } else if (entry.snippet && entry.format === "sheet") {
    frame.append(sheetPreview(entry.snippet));
  } else {
    frame.append(illustration(entry.format));
  }
  return frame;
}
