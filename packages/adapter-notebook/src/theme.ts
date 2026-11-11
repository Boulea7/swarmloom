/**
 * Notebook colours and the style sheet shared by the stage (Blueprint.css) and the measuring
 * sandbox. Everything is scoped to `.slnb-*` classes. The palette is SwarmLoom's own.
 */

export const UI_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
export const MONO_FONT =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Noto Sans Mono", monospace';

export interface NotebookPalette {
  scheme: "light" | "dark";
  page: string;
  ink: string;
  muted: string;
  cell: string;
  border: string;
  stripe: string;
  inline: string;
  link: string;
  promptIn: string;
  promptOut: string;
  stderr: string;
  error: string;
  errorInk: string;
  /** Syntax colours by highlight.js scope group. */
  syntax: Record<SyntaxGroup, string>;
}

export type SyntaxGroup =
  | "keyword"
  | "builtin"
  | "type"
  | "number"
  | "string"
  | "comment"
  | "meta"
  | "title"
  | "attr"
  | "added"
  | "removed";

const LIGHT: NotebookPalette = {
  scheme: "light",
  page: "#FAFAFC",
  ink: "#1D1E2C",
  muted: "#6B6F85",
  cell: "#F2F3F8",
  border: "#DDDFEA",
  stripe: "#F5F6FA",
  inline: "#ECEDF5",
  link: "#4747E0",
  promptIn: "#5B5BF7",
  promptOut: "#E23D68",
  stderr: "#FFF6E8",
  error: "#FFF0F2",
  errorInk: "#B4233A",
  syntax: {
    keyword: "#4B4BE0",
    builtin: "#9333B8",
    type: "#0F7F72",
    number: "#A3620A",
    string: "#B43C2F",
    comment: "#7C7F93",
    meta: "#9333B8",
    title: "#0F7F72",
    attr: "#3B6FD6",
    added: "#1F8A52",
    removed: "#C8283C",
  },
};

const DARK: NotebookPalette = {
  scheme: "dark",
  page: "#0B0B12",
  ink: "#E6E7EF",
  muted: "#9093A8",
  cell: "#141522",
  border: "#272938",
  stripe: "#11121C",
  inline: "#1D1F2E",
  link: "#9B9BFF",
  promptIn: "#8B8BFF",
  promptOut: "#FF6B8F",
  stderr: "#241C10",
  error: "#2A1420",
  errorInk: "#FF8A9A",
  syntax: {
    keyword: "#8B8BFF",
    builtin: "#E07BF0",
    type: "#2DD4BF",
    number: "#F5B54A",
    string: "#FF8A7A",
    comment: "#7E8199",
    meta: "#E07BF0",
    title: "#2DD4BF",
    attr: "#6FB8F7",
    added: "#4ADE80",
    removed: "#FF7A85",
  },
};

/** The palette of a colour scheme. */
export function notebookPalette(scheme: "light" | "dark"): NotebookPalette {
  return scheme === "dark" ? DARK : LIGHT;
}

/** Code and output metrics, CSS px. */
export const CODE_FONT_PX = 13;
export const CODE_LINE_PX = 20;
export const OUT_LINE_PX = 19;
export const MD_FONT_PX = 15;

/**
 * Style sheet for markdown cells, HTML outputs and placeholders. Markdown cells carry the markup of
 * adapter-markdown's renderer (`.loom-doc`, real bullet, number and checkbox elements), restyled
 * here in the notebook palette.
 */
export function notebookCss(p: NotebookPalette): string {
  return `
.slnb-md{font:${MD_FONT_PX}px/1.6 ${UI_FONT};color:${p.ink};overflow-wrap:anywhere}
.slnb-md .loom-body>:first-child,.slnb-html>:first-child{margin-top:0}
.slnb-md .loom-body>:last-child,.slnb-html>:last-child{margin-bottom:0}
.slnb-md .loom-thread{display:none}
.slnb-md h1,.slnb-md h2,.slnb-md h3,.slnb-md h4,.slnb-md h5,.slnb-md h6{margin:1.1em 0 .45em;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.slnb-md h1{font-size:1.9em}.slnb-md h2{font-size:1.45em}.slnb-md h3{font-size:1.2em}
.slnb-md h4{font-size:1.05em}.slnb-md h5,.slnb-md h6{font-size:1em;color:${p.muted}}
.slnb-md p,.slnb-md ul,.slnb-md ol,.slnb-md blockquote,.slnb-md table,.slnb-md pre,.slnb-md .loom-code,.slnb-md figure,.slnb-md .loom-math-block{margin:0 0 .75em}
.slnb-md ul,.slnb-md ol{padding:0;list-style:none}
.slnb-md li{position:relative;padding-left:1.6em}
.slnb-md li+li{margin-top:.2em}
.slnb-md li>ul,.slnb-md li>ol,.slnb-md li>p{margin:.2em 0 0}
.slnb-md .loom-bullet{position:absolute;left:.5em;top:calc(.8em - 2.5px);width:5px;height:5px;border-radius:50%;background:currentColor}
.slnb-md li li .loom-bullet{background:none;box-shadow:inset 0 0 0 1.2px currentColor}
.slnb-md ol>li{padding-left:2em}
.slnb-md .loom-num{position:absolute;left:0;width:1.5em;text-align:right;font-variant-numeric:tabular-nums}
.slnb-md .task-box{position:absolute;left:0;top:calc(.8em - 7px);width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1.5px ${p.muted}}
.slnb-md .task-box[aria-label="done"]{background:${p.promptIn};box-shadow:none}
.slnb-md .task-box[aria-label="done"]::after{content:"✓";position:absolute;inset:0;color:#fff;font:700 11px/14px ${UI_FONT};text-align:center}
.slnb-md code{font:.88em ${MONO_FONT};background:${p.inline};padding:.12em .36em;border-radius:4px}
.slnb-md pre{background:${p.cell};border:1px solid ${p.border};border-radius:6px;padding:10px 12px;font:${CODE_FONT_PX}px/${CODE_LINE_PX}px ${MONO_FONT};white-space:pre-wrap;overflow-wrap:anywhere}
.slnb-md pre code{background:none;padding:0;font:inherit;border-radius:0}
.slnb-md .loom-code{background:${p.cell};border:1px solid ${p.border};border-radius:6px}
.slnb-md .loom-code pre{margin:0;border:0;background:none}
.slnb-md .loom-code-head{padding:6px 12px 0;color:${p.muted};font:600 11px/1.4 ${UI_FONT};letter-spacing:.06em;text-transform:uppercase}
.slnb-md blockquote{border-left:3px solid ${p.promptIn};padding:.1em 0 .1em 1em;color:${p.muted}}
.slnb-md .loom-callout-title{margin:0 0 .3em;color:${p.promptIn};font-size:.86em;font-weight:700}
.slnb-md figure{text-align:center}
.slnb-md figcaption,.slnb-md .loom-blocked{color:${p.muted};font-size:.86em}
.slnb-md .footnotes{font-size:.88em;color:${p.muted}}
.slnb-md .footnotes hr{margin:.8em 0 .5em}
.slnb-md .fn-back,.slnb-md .fn-ref a{text-decoration:none}
.slnb-md a,.slnb-html a{color:${p.link};text-decoration:underline;text-underline-offset:2px}
.slnb-md hr{border:0;border-top:1px solid ${p.border};margin:1.2em 0}
.slnb-md del{color:${p.muted}}
.slnb-md sup{font-size:.75em;line-height:0}
.slnb-md table,.slnb-html table{border-collapse:collapse;font-variant-numeric:tabular-nums}
.slnb-md th,.slnb-md td{border:1px solid ${p.border};padding:.35em .7em}
.slnb-md th{background:${p.cell};font-weight:600}
.slnb-md img,.slnb-html img{max-width:100%;height:auto;vertical-align:middle}
.slnb-noimg{display:inline-block;padding:.15em .5em;border:1px dashed ${p.border};border-radius:4px;color:${p.muted};font:12px/1.5 ${UI_FONT}}
.slnb-html{font:13px/1.5 ${UI_FONT};color:${p.ink};overflow-wrap:anywhere}
.slnb-html p,.slnb-html ul,.slnb-html ol,.slnb-html table{margin:0 0 .6em}
.slnb-html th,.slnb-html td{padding:.3em .65em;border-bottom:1px solid ${p.border};text-align:right;vertical-align:top}
.slnb-html thead th{border-bottom:1.5px solid ${p.muted};font-weight:600}
.slnb-html tbody th{font-weight:600}
.slnb-html tbody tr:nth-child(odd){background:${p.stripe}}
.slnb-html code,.slnb-html pre{font-family:${MONO_FONT}}
`.trim();
}

/** Inline style of a syntax group. */
export function syntaxCss(p: NotebookPalette, group: SyntaxGroup): string {
  const color = `color:${p.syntax[group]}`;
  return group === "comment" ? `${color};font-style:italic` : color;
}
