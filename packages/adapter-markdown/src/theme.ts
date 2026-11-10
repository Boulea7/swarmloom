import { codeTheme, MONO_FONT } from "@swarmloom/adapter-code";

/** Colours of the Loom document theme for one scheme. */
export interface LoomPalette {
  scheme: "light" | "dark";
  page: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  accent: string;
  accentSoft: string;
  link: string;
  inlineCodeBg: string;
  inlineCodeInk: string;
  codeBg: string;
  codeBorder: string;
  tableHead: string;
  tableZebra: string;
  thread: string;
  callout: Record<CalloutKind, string>;
}

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

export const LOOM_LIGHT: LoomPalette = {
  scheme: "light",
  page: "#FAFAFC",
  ink: "#16161F",
  ink2: "#3D3D52",
  muted: "#66667D",
  line: "rgba(11, 11, 18, 0.12)",
  accent: "#5B5BF7",
  accentSoft: "rgba(91, 91, 247, 0.07)",
  link: "#4343DB",
  inlineCodeBg: "rgba(91, 91, 247, 0.09)",
  inlineCodeInk: "#3535B8",
  codeBg: "#F4F4FA",
  codeBorder: "rgba(11, 11, 18, 0.08)",
  tableHead: "#F0F0F7",
  tableZebra: "rgba(11, 11, 18, 0.022)",
  thread: "linear-gradient(90deg, #5B5BF7 0%, #D946EF 55%, #FF6B5B 100%)",
  callout: { note: "#0A6FAD", tip: "#0B7D60", important: "#7C3AED", warning: "#9A4A06", caution: "#C5283F" },
};

export const LOOM_DARK: LoomPalette = {
  scheme: "dark",
  page: "#0E0E16",
  ink: "#E7E7F1",
  ink2: "#B8B8CC",
  muted: "#8D8DA6",
  line: "rgba(255, 255, 255, 0.13)",
  accent: "#8E8EFF",
  accentSoft: "rgba(142, 142, 255, 0.09)",
  link: "#A9A9FF",
  inlineCodeBg: "rgba(142, 142, 255, 0.14)",
  inlineCodeInk: "#C9C9FF",
  codeBg: codeTheme("dark").background,
  codeBorder: "rgba(255, 255, 255, 0.08)",
  tableHead: "#191925",
  tableZebra: "rgba(255, 255, 255, 0.025)",
  thread: "linear-gradient(90deg, #8E8EFF 0%, #E879F9 55%, #FF8A7A 100%)",
  callout: { note: "#6CC4FF", tip: "#5FD4B0", important: "#C4A1FF", warning: "#F5C26B", caution: "#FF8A9A" },
};

/** Palette for a colour scheme. */
export function loomPalette(scheme: "light" | "dark"): LoomPalette {
  return scheme === "dark" ? LOOM_DARK : LOOM_LIGHT;
}

/** Body text stack: Latin UI fonts first, then CJK fonts for every major platform. */
export const TEXT_FONT =
  '"Inter", "Segoe UI Variable Text", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ' +
  '"PingFang SC", "Hiragino Sans GB", "Hiragino Sans", "Microsoft YaHei UI", "Microsoft YaHei", ' +
  '"Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "Apple SD Gothic Neo", "Noto Sans", sans-serif';

/** Width of the text column in CSS px: a comfortable measure for Latin text and CJK alike. */
export const MEASURE = 720;

/**
 * The Loom document theme: an original reading style for Markdown with a centred 720 px column,
 * generous rhythm, CJK-aware font stacks, real elements for bullets and checkboxes (so the swarm
 * can build them) and colour tokens for light and dark. Every rule is scoped under `.loom-doc`.
 */
export function loomThemeCss(scheme: "light" | "dark"): string {
  const p = loomPalette(scheme);
  const c = codeTheme(scheme);
  return `
.loom-doc {
  --page: ${p.page}; --ink: ${p.ink}; --ink-2: ${p.ink2}; --muted: ${p.muted}; --line: ${p.line};
  --accent: ${p.accent}; --accent-soft: ${p.accentSoft}; --link: ${p.link};
  --code-inline-bg: ${p.inlineCodeBg}; --code-inline-ink: ${p.inlineCodeInk};
  --code-bg: ${p.codeBg}; --code-border: ${p.codeBorder}; --code-ink: ${c.foreground};
  --table-head: ${p.tableHead}; --table-zebra: ${p.tableZebra};
  --note: ${p.callout.note}; --tip: ${p.callout.tip}; --important: ${p.callout.important};
  --warning: ${p.callout.warning}; --caution: ${p.callout.caution};
  box-sizing: border-box; width: 100%; margin: 0; padding: 64px 24px 88px;
  background: var(--page); color: var(--ink);
  font-family: ${TEXT_FONT}; font-size: 16px; line-height: 1.75;
  font-kerning: normal; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word; color-scheme: ${scheme};
}
.loom-doc *, .loom-doc *::before, .loom-doc *::after { box-sizing: border-box; }
.loom-doc .loom-body { max-width: ${MEASURE}px; margin: 0 auto; }
.loom-doc .loom-body > :first-child { margin-top: 0; }
.loom-doc h1, .loom-doc h2, .loom-doc h3, .loom-doc h4, .loom-doc h5, .loom-doc h6 {
  margin: 2em 0 0.6em; color: var(--ink); font-weight: 700; line-height: 1.3; letter-spacing: -0.01em;
}
.loom-doc h1 { font-size: 2.4em; font-weight: 800; line-height: 1.18; letter-spacing: -0.022em; margin: 0 0 0.35em; }
.loom-doc h2 { font-size: 1.6em; padding-bottom: 0.35em; border-bottom: 1px solid var(--line); }
.loom-doc h3 { font-size: 1.28em; }
.loom-doc h4 { font-size: 1.08em; }
.loom-doc h5 { font-size: 1em; }
.loom-doc h6 { font-size: 0.9em; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }
.loom-doc .loom-thread { width: 64px; height: 4px; border-radius: 2px; background: ${p.thread}; margin: 0 0 2em; }
.loom-doc p { margin: 0 0 1.1em; }
.loom-doc a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.22em; }
.loom-doc strong { font-weight: 650; color: var(--ink); }
.loom-doc del { color: var(--muted); text-decoration-thickness: 1px; }
.loom-doc mark { background: rgba(245, 165, 36, 0.28); color: inherit; border-radius: 3px; padding: 0 0.15em; }
.loom-doc code, .loom-doc kbd, .loom-doc samp { font-family: ${MONO_FONT}; font-variant-ligatures: none; }
.loom-doc :not(pre) > code {
  font-size: 0.86em; padding: 0.14em 0.42em; border-radius: 6px;
  background: var(--code-inline-bg); color: var(--code-inline-ink);
}
.loom-doc kbd {
  font-size: 0.82em; padding: 0.08em 0.45em; border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: 6px; background: var(--page); color: var(--ink-2);
}
.loom-doc hr { height: 1px; border: 0; margin: 2.4em 0; background: var(--line); }
.loom-doc blockquote {
  margin: 1.5em 0; padding: 0.9em 1.25em; border-left: 3px solid var(--accent);
  border-radius: 0 12px 12px 0; background: var(--accent-soft); color: var(--ink-2);
}
.loom-doc blockquote > :last-child { margin-bottom: 0; }
.loom-doc .loom-callout { --tone: var(--note); border-left-color: var(--tone); background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.loom-doc .loom-callout-tip { --tone: var(--tip); }
.loom-doc .loom-callout-important { --tone: var(--important); }
.loom-doc .loom-callout-warning { --tone: var(--warning); }
.loom-doc .loom-callout-caution { --tone: var(--caution); }
.loom-doc .loom-callout-title { margin: 0 0 0.4em; color: var(--tone); font-size: 0.86em; font-weight: 700; letter-spacing: 0.03em; }
.loom-doc ul, .loom-doc ol { margin: 0 0 1.1em; padding: 0; list-style: none; }
.loom-doc li { position: relative; margin: 0.35em 0; padding-left: 1.6em; }
.loom-doc li > ul, .loom-doc li > ol { margin: 0.35em 0 0; }
.loom-doc li > p { margin: 0 0 0.6em; }
.loom-doc .loom-bullet {
  position: absolute; left: 0.4em; top: calc(0.875em - 3px); width: 6px; height: 6px;
  border-radius: 50%; background: var(--accent);
}
.loom-doc li li .loom-bullet { background: transparent; box-shadow: inset 0 0 0 1.5px var(--accent); }
.loom-doc li li li .loom-bullet { border-radius: 1.5px; background: var(--muted); box-shadow: none; }
.loom-doc ol > li { padding-left: calc(var(--loom-num-w, 1.4em) + 0.5em); }
.loom-doc .loom-num {
  position: absolute; left: 0; top: 0; width: var(--loom-num-w, 1.4em); text-align: right;
  color: var(--accent); font-weight: 650; font-variant-numeric: tabular-nums;
}
.loom-doc .task-item { padding-left: 1.85em; }
.loom-doc .task-box {
  position: absolute; left: 0; top: calc(0.875em - 8px); width: 16px; height: 16px; border-radius: 5px;
  box-shadow: inset 0 0 0 1.5px var(--muted); background: var(--page);
}
.loom-doc .task-box[data-checked="true"] { background: var(--accent); box-shadow: none; }
.loom-doc .task-box svg { display: block; width: 16px; height: 16px; }
.loom-doc .task-item[data-checked="true"] > .task-label { color: var(--muted); }
.loom-doc table {
  width: 100%; margin: 1.5em 0; border-collapse: separate; border-spacing: 0; font-size: 0.94em; line-height: 1.6;
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
}
.loom-doc th, .loom-doc td { padding: 0.62em 0.95em; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
.loom-doc th { background: var(--table-head); color: var(--ink); font-weight: 650; text-align: left; }
.loom-doc tbody tr:nth-child(even) td { background: var(--table-zebra); }
.loom-doc tbody tr:last-child td { border-bottom: 0; }
.loom-doc .loom-code {
  margin: 1.5em 0; border: 1px solid var(--code-border); border-radius: 12px; background: var(--code-bg); overflow: hidden;
}
.loom-doc .loom-code-head {
  padding: 0.7em 1.15em 0; color: var(--muted); font-size: 0.72em; font-weight: 650;
  letter-spacing: 0.08em; line-height: 1.4; text-transform: uppercase;
}
.loom-doc pre {
  margin: 0; padding: 0.85em 1.15em 1.05em; color: var(--code-ink); font-family: ${MONO_FONT};
  font-size: 0.86em; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4;
}
.loom-doc .loom-figure { margin: 1.8em 0; text-align: center; }
.loom-doc img { max-width: 100%; height: auto; vertical-align: middle; border-radius: 10px; }
.loom-doc .loom-figure img { border-radius: 14px; }
.loom-doc figcaption { margin-top: 0.7em; color: var(--muted); font-size: 0.86em; }
.loom-doc .loom-blocked { color: var(--muted); font-style: italic; }
.loom-doc .loom-math-block { margin: 1.4em 0; text-align: center; overflow: hidden; }
.loom-doc .loom-math-error { color: var(--caution); }
.loom-doc .loom-diagram { margin: 1.8em 0; text-align: center; }
.loom-doc .loom-diagram svg { max-width: 100%; height: auto; }
.loom-doc sup.fn-ref { font-size: 0.72em; line-height: 0; }
.loom-doc sup.fn-ref a { text-decoration: none; font-weight: 650; padding: 0 0.1em; }
.loom-doc .footnotes { margin-top: 3.2em; color: var(--ink-2); font-size: 0.88em; }
.loom-doc .footnotes hr { margin: 0 0 1.4em; }
.loom-doc .fn-back { text-decoration: none; margin-left: 0.3em; }
`;
}
