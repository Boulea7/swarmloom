// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Option names declared on the PlayerOptions interface in types.ts. */
function playerOptionNames(): string[] {
  const body = /export interface PlayerOptions \{([\s\S]*?)\n\}/.exec(read("../src/types.ts"))?.[1] ?? "";
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] as string);
}

// The API guides say the createPlayer table lists every option besides `blueprint`.
it.each(["docs/api.md", "docs/en/api.md"])("%s lists every createPlayer option", (file) => {
  const text = read(`../../../${file}`);
  const names = playerOptionNames();
  expect(names).toContain("overlays");
  expect(names.filter((name) => name !== "blueprint" && !text.includes(`| \`${name}\` |`))).toEqual([]);
});
