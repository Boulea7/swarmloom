import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { layoutEditor, MONO_FONT } from "./editor/layout";
import { canvasMeasurer, monoCharRatio } from "./editor/measure";
import { detectLanguage } from "./syntax/detect";
import { expandTabs, highlight } from "./syntax/highlight";
import { type LanguageSpec, languageById, languageForFence } from "./syntax/languages";
import { codeTheme } from "./syntax/themes";
import { type LoadedText, readSource, type TextAdapter } from "./util/source";

/** Options of {@link createCodeAdapter}. */
export interface CodeAdapterOptions {
  /** Reject sources larger than this many bytes. Default 2 MiB. */
  maxBytes?: number;
  /** Render at most this many lines (the rest is reported in Blueprint.truncated). Default 1500. */
  maxLines?: number;
  /** Force a language by id or alias instead of detecting it. */
  language?: string;
  /** Tab stop used when expanding tabs. Default 4. */
  tabSize?: number;
  /** Font size range in px. Default 10..15. */
  fontSize?: { min: number; max: number };
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Extensions and MIME types; keep in sync with packages/formats/src/registry.ts. */
const EXTENSIONS = [
  "txt",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "json",
  "css",
  "scss",
  "less",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "yaml",
  "yml",
  "toml",
  "xml",
  "vue",
  "svelte",
  "lua",
  "dart",
  "scala",
];

const MIME = [
  "text/plain",
  "text/javascript",
  "application/javascript",
  "application/json",
  "text/css",
  "application/typescript",
  "text/x-python",
  "text/x-c",
  "text/x-java-source",
  "application/xml",
  "text/xml",
  "application/x-sh",
  "application/toml",
  "application/yaml",
];

function checkContext(ctx: AdapterContext): void {
  if (!ctx || typeof ctx !== "object") throw new TypeError("code: missing AdapterContext");
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`code: ctx.width must be positive, got ${ctx.width}`);
  if (ctx.theme !== "light" && ctx.theme !== "dark") throw new TypeError(`code: ctx.theme must be "light" or "dark"`);
}

function resolveForced(name: string | undefined): LanguageSpec | undefined {
  if (!name) return undefined;
  const lang = languageById(name) ?? languageForFence(name);
  if (!lang) throw new TypeError(`code: unknown language ${JSON.stringify(name)}`);
  return lang;
}

/**
 * Creates the source code adapter: detects the language, highlights it with lazily loaded
 * highlight.js grammars and lays it out as an editor panel whose lines are typed by the cursors.
 */
export function createCodeAdapter(options: CodeAdapterOptions = {}): TextAdapter {
  const forced = resolveForced(options.language);
  return {
    id: "code",
    label: "Source code",
    extensions: EXTENSIONS,
    mime: MIME,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedText> {
      checkContext(ctx);
      ctx.signal?.throwIfAborted();
      const src = await readSource(input, {
        adapter: "code",
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const fileName = src.name ?? "untitled";
      const language = forced ?? detectLanguage({ name: src.name, mime: src.mime, text: src.text });
      const code = src.text
        .replace(/^﻿/, "")
        .split(/\r\n|\r|\n/)
        .map((l) => expandTabs(l, options.tabSize ?? 4))
        .join("\n");
      const highlighted = await highlight(code, language);
      ctx.signal?.throwIfAborted();

      const measure = canvasMeasurer(ctx.document);
      const { blueprint } = layoutEditor(highlighted, {
        width: ctx.width,
        theme: codeTheme(ctx.theme),
        fileName,
        url: src.url,
        charRatio: monoCharRatio(measure, MONO_FONT),
        measure,
        maxLayers: ctx.maxLayers,
        maxLines: options.maxLines,
        fontSize: options.fontSize,
        locale: ctx.locale,
        warning: highlighted.warning,
      });
      const warnings = highlighted.warning ? [`code: ${highlighted.warning}`] : [];
      if (blueprint.truncated) warnings.push(`code: ${blueprint.truncated.reason}`);
      return { blueprint, warnings };
    },
  };
}

/** Source code adapter with default options (id "code"). */
export const codeAdapter: TextAdapter = createCodeAdapter();
