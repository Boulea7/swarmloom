/**
 * @swarmloom/adapter-terminal: asciinema recordings (.cast v1/v2/v3) woven as a terminal window.
 * Keystrokes are typed at the recorded pace, output streams in, and a block caret blinks.
 */

export { createTerminalAdapter, DEFAULT_MAX_BYTES, type TerminalAdapterOptions, terminalAdapter } from "./adapter";
export * from "./ansi";
export {
  type CastCode,
  CastError,
  type CastEvent,
  type CastRecording,
  looksLikeCast,
  MAX_EVENTS,
  parseCast,
} from "./cast";
export { buildTerminalBlueprint, MONO_FONT, measureCell, type TerminalLayoutOptions, terminalIcon } from "./layers";
export {
  type ModelView,
  readScreenData,
  type ScreenEvent,
  TerminalModel,
  type TerminalScreenData,
  type TerminalStepData,
  TerminalView,
} from "./model";
export { createTerminalPlugin, SCREEN_TASK, STEP_TASK, TERMINAL_PLUGIN, terminalPlugin } from "./plugin";
export {
  buildTimeline,
  type PlayEvent,
  type PlayKind,
  type Step,
  splitSteps,
  type Timeline,
  type TimelineOptions,
} from "./timeline";
