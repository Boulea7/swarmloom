import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { STAMP, staleFiles, writeStamp } from "../scripts/render-stamp.mjs";

it("reports the sources that changed since the render page was stamped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "render-stamp-"));
  try {
    const engine = path.join(dir, "src/engine.ts");
    const page = path.join(dir, "render/index.html");
    await mkdir(path.dirname(engine), { recursive: true });
    await mkdir(path.dirname(page), { recursive: true });
    await mkdir(path.join(dir, "dist"));
    expect(await staleFiles(dir)).toEqual([STAMP]);

    await writeFile(engine, "export const speed = 1;\n");
    await writeFile(page, "<script src=render.js></script>\n");
    await writeStamp(dir, [engine, page, path.join(dir, "gone.ts")]);
    expect(await staleFiles(dir)).toEqual([]);

    await writeFile(engine, "export const speed = 2;\n");
    await rm(page);
    expect(await staleFiles(dir)).toEqual(["render/index.html", "src/engine.ts"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
