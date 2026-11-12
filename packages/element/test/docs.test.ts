// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as globalApi from "../src/cdn/global";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const pkg = JSON.parse(read("../package.json")) as { unpkg: string };

// The element guides describe the script build that ships today: its file, its global and every name on it.
it.each(["docs/element.md", "docs/en/element.md"])("%s documents the script build's global API", (file) => {
  const text = read(`../../../${file}`);
  expect(text).toContain(pkg.unpkg.replace(/^\.\//, ""));
  expect(text).toContain("window.SwarmLoom");
  expect(Object.keys(globalApi).filter((name) => !text.includes(`\`${name}\``))).toEqual([]);
});
