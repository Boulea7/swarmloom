import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import type { TerminalTheme } from "./ansi/palette";
import { looksLikeCast, parseCast } from "./cast";
import { buildTerminalBlueprint } from "./layers";
import { createTerminalPlugin } from "./plugin";
import { baseName, checkContext, readText } from "./source";
import { buildTimeline, type TimelineOptions } from "./timeline";

/** Default input size limit: 32 MiB of cast text. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export interface TerminalAdapterOptions extends TimelineOptions {
  /** Reject larger inputs. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
  /** Preferred font size in px. Default 14 (shrinks to fit the layout width; see `fill`). */
  fontSize?: number;
  /** Terminal colours; overrides the recording's theme. */
  theme?: TerminalTheme;
  /** Shrink the window to the rows/columns the session uses. Default true. */
  fit?: boolean;
  /**
   * Let the font grow past `fontSize` until the window fills the layout width, or
   * `viewportHeight` when that comes first. Default false: the font only shrinks to fit the width.
   */
  fill?: boolean;
  /** Height of the stage, px, that `fill` keeps the window within. Default: none (width only). */
  viewportHeight?: number;
  /** Window title override. */
  title?: string;
}

/**
 * Creates the asciinema adapter (.cast v1, v2 and v3). Each load returns its own plugin instance
 * so two players never share playback state.
 */
export function createTerminalAdapter(options: TerminalAdapterOptions = {}): Adapter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
  return {
    id: "terminal",
    label: "Terminal recording",
    extensions: ["cast"],
    mime: ["application/x-asciicast"],
    sniff: (head) => looksLikeCast(head),
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      checkContext(ctx, "terminal");
      const text = await readText(input, maxBytes, "terminal recording", ctx.signal);
      ctx.signal?.throwIfAborted();
      const recording = parseCast(text);
      const timeline = buildTimeline(recording, options);
      const name = baseName(input);
      const blueprint = buildTerminalBlueprint(recording, timeline, {
        document: ctx.document,
        width: ctx.width,
        scheme: ctx.theme === "dark" ? "dark" : "light",
        ...(options.fontSize ? { fontSize: options.fontSize } : {}),
        ...(options.theme ? { theme: options.theme } : {}),
        ...(options.fit === false ? { fit: false } : {}),
        ...(options.fill ? { fill: true } : {}),
        ...(options.viewportHeight ? { height: options.viewportHeight } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(name ? { name } : {}),
      });
      return { blueprint, plugins: [createTerminalPlugin()] };
    },
  };
}

/** The asciinema adapter with default options. */
export const terminalAdapter: Adapter = createTerminalAdapter();
