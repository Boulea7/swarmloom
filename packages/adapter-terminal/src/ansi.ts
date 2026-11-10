/**
 * `@swarmloom/adapter-terminal/ansi`: the ANSI/VT toolkit without the adapter (used by the
 * notebook adapter for coloured stream output and tracebacks).
 */

export { ansiToHtml, ansiToRuns, escapeHtml, type LogRun, stripAnsi } from "./ansi/html";
export { LOOM_INK, LOOM_PAPER, normalizeHex, rgbHex, type TerminalTheme, themeFrom, xterm256 } from "./ansi/palette";
export { type AnsiHandler, AnsiParser } from "./ansi/parser";
export {
  type Attrs,
  applySgr,
  attrsCss,
  BOLD,
  colorCss,
  DEFAULT_COLOR,
  DIM,
  HIDDEN,
  INVERSE,
  ITALIC,
  PLAIN,
  parseParams,
  RGB_FLAG,
  STRIKE,
  UNDERLINE,
} from "./ansi/sgr";
export { charWidth, stringWidth } from "./ansi/width";
export { type Cell, MAX_COLS, MAX_ROWS, type Run, Screen } from "./screen";
