// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderPageProblem } from "./real-deps";

describe("renderPageProblem", () => {
  let repo = "";
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  /** A built page at t=2000 s over inputs written at t=1000 s. */
  function builtRepo(): string {
    repo = mkdtempSync(path.join(tmpdir(), "swarmloom-render-page-"));
    const inputs = [
      "packages/core/src/index.ts",
      "packages/export/render/index.html",
      "packages/export/vite.render.config.ts",
    ];
    for (const file of inputs) write(file, 1000);
    write("packages/export/dist/render/index.html", 2000);
    return repo;
  }

  function write(file: string, seconds: number): void {
    const full = path.join(repo, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "x");
    utimesSync(full, seconds, seconds);
  }

  it("accepts a page built after every input", () => {
    expect(renderPageProblem(builtRepo())).toBeUndefined();
  });

  it.each([
    ["packages/core/src/index.ts", "packages/core/src"],
    ["packages/export/render/index.html", "packages/export/render"],
    ["packages/export/vite.render.config.ts", "packages/export/vite.render.config.ts"],
  ])("rebuilds after %s changed", (file, input) => {
    builtRepo();
    write(file, 3000);
    expect(renderPageProblem(repo)).toBe(`render page is older than ${input}: run pnpm -F @swarmloom/export build`);
  });
});
