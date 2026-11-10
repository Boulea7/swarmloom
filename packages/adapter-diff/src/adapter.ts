import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { parsePullUrl } from "./github";
import { buildDiffBlueprint } from "./layers";
import { DiffError, looksLikePatch, type ParseOptions, parsePatch } from "./parse";
import { createDiffPlugin } from "./plugin";
import { baseName, checkContext, readText } from "./source";

/** Default input size limit: 16 MiB of patch text. */
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export interface DiffAdapterOptions extends ParseOptions {
  /** Show authors as "Author 1..n" and leave names and e-mail addresses out of the blueprint. */
  anonymize?: boolean;
  /** Reject larger inputs. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
  /** Tab width in columns. Default 4. */
  tabSize?: number;
}

/**
 * Creates the patch adapter: unified diffs, git diffs, `git log -p` and `git format-patch`
 * mailboxes, one review panel per file.
 */
export function createDiffAdapter(options: DiffAdapterOptions = {}): Adapter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
  return {
    id: "diff",
    label: "Patch",
    extensions: ["diff", "patch"],
    mime: ["text/x-diff", "text/x-patch", "application/x-patch"],
    sniff: (head) => looksLikePatch(new TextDecoder().decode(head)),
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      checkContext(ctx, "diff");
      if (input.url && typeof input.text !== "string" && !input.bytes && parsePullUrl(input.url)) {
        throw new DiffError(
          "GitHub pull request URLs are opened by the CLI only (swarmloom <url>); in the browser, download the .diff and open the file",
        );
      }
      const text = await readText(input, maxBytes, "patch", ctx.signal);
      ctx.signal?.throwIfAborted();
      const patch = parsePatch(text, options);
      const name = baseName(input);
      const blueprint = buildDiffBlueprint(patch, {
        document: ctx.document,
        width: ctx.width,
        theme: ctx.theme === "dark" ? "dark" : "light",
        ...(options.anonymize ? { anonymize: true } : {}),
        ...(ctx.maxLayers ? { maxLayers: ctx.maxLayers } : {}),
        ...(options.tabSize ? { tabSize: options.tabSize } : {}),
        ...(name ? { name } : {}),
      });
      return { blueprint, plugins: [createDiffPlugin()] };
    },
  };
}

/** The patch adapter with default options. */
export const diffAdapter: Adapter = createDiffAdapter();
