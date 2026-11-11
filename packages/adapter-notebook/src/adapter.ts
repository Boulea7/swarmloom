import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { buildNotebookBlueprint } from "./layers";
import { looksLikeNotebook, type ParseOptions, parseNotebook } from "./nbformat";
import { createNotebookPlugin } from "./plugin";
import { baseName, checkContext, readText } from "./source";

/** Default input size limit: 64 MiB of notebook JSON (embedded images make notebooks large). */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export interface NotebookAdapterOptions extends ParseOptions {
  /** Reject larger inputs. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
  /** "color" (default) keeps ANSI colours in streams and tracebacks; "strip" removes them. */
  ansi?: "color" | "strip";
  /** Longest text output shown, lines. Default 300. */
  maxOutputLines?: number;
  /** Tallest output shown, px; taller outputs are clipped. Default 1600. */
  maxOutputHeight?: number;
}

/**
 * Creates the Jupyter notebook adapter (.ipynb, nbformat 4). Each load returns its own plugin
 * instance so two players never share run indicator state.
 */
export function createNotebookAdapter(options: NotebookAdapterOptions = {}): Adapter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
  return {
    id: "notebook",
    label: "Jupyter notebook",
    extensions: ["ipynb"],
    mime: ["application/x-ipynb+json"],
    sniff: (head) => looksLikeNotebook(head),
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      checkContext(ctx, "notebook");
      const text = await readText(input, maxBytes, "notebook", ctx.signal);
      ctx.signal?.throwIfAborted();
      const notebook = parseNotebook(text, options);
      const name = baseName(input);
      const blueprint = buildNotebookBlueprint(notebook, {
        document: ctx.document,
        width: ctx.width,
        theme: ctx.theme === "dark" ? "dark" : "light",
        ...(name ? { name } : {}),
        ...(ctx.maxLayers ? { maxLayers: ctx.maxLayers } : {}),
        ...(options.ansi ? { ansi: options.ansi } : {}),
        ...(options.maxOutputLines ? { maxOutputLines: options.maxOutputLines } : {}),
        ...(options.maxOutputHeight ? { maxOutputHeight: options.maxOutputHeight } : {}),
      });
      return { blueprint, plugins: [createNotebookPlugin()] };
    },
  };
}

/** The notebook adapter with default options. */
export const notebookAdapter: Adapter = createNotebookAdapter();
