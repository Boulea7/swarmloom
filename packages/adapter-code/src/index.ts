import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * Source code -> syntax-highlighted text typed character by character.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const codeAdapter: Adapter = {
  id: "code",
  label: "Source code",
  extensions: [
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
  ],
  mime: [
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
  ],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

export default codeAdapter;
