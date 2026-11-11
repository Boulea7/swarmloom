/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { FORMAT_META } from "../src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const READMES = [
  "README.md",
  "README.en.md",
  ...["de", "es", "fr", "ja", "ko", "zh-TW"].map((l) => `docs/i18n/README.${l}.md`),
];

// The roadmap "now" line counts file formats; "dom" is the web-page entry and is listed separately.
it.each(READMES)("%s roadmap counts every registered file format", (file) => {
  const line = readFileSync(join(ROOT, file), "utf8")
    .split("\n")
    .find((l) => l.startsWith("- **") && l.includes("Chrome / Edge / Firefox / Safari"));
  expect(Number(line?.match(/\d+/)?.[0])).toBe(FORMAT_META.filter((m) => m.id !== "dom").length);
});
