import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSourceUrl, parseRoute, type Route, routeToUrl } from "../src/route";
import { DEFAULT_SETTINGS, impactOf, playerOptionsFrom } from "../src/settings";
import { decodeShare, encodeShare, MAX_INFLATED_BYTES, ShareError, sanitizeShareName } from "../src/share";
import type { OpenedSource } from "../src/source";
import { buildShareLink } from "../src/views/share-link";

const BASE = "https://studio.example/app/";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function deflate(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return base64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

describe("share links", () => {
  it("round-trips text, name and settings through the hash payload", async () => {
    const text = "# 标题\n\nSome *markdown* with unicode: é ü 中文.\n".repeat(20);
    const encoded = await encodeShare({ name: "notes.md", text, settings: { seed: 42, speed: 2 } });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(text.length);
    const decoded = await decodeShare(encoded);
    expect(decoded).toEqual({ name: "notes.md", text, settings: { seed: 42, speed: 2 } });
  });

  it("keeps only performance settings from a link, never privacy or sound", async () => {
    const s = { seed: 7, remoteAssets: true, sound: true, volume: 1, theme: "dark", locale: "ja" };
    const decoded = await decodeShare(await deflate(JSON.stringify({ v: 1, n: "a.md", x: "hi", s })));
    expect(decoded).toEqual({ name: "a.md", text: "hi", settings: { seed: 7 } });
  });

  // Both shift the build's timeline and its end, so a link without them plays a different show.
  it.each([
    ["an example, in the query", { ref: { kind: "example", id: "svg-chart" }, name: "chart.svg" }],
    ["a local text, in the hash", { ref: { kind: "file", name: "notes.md" }, name: "notes.md", text: "# N" }],
  ])("carries the opening and the glide to the top for %s", async (_label, opened) => {
    const settings = { ...DEFAULT_SETTINGS, opening: true, liveTop: true };
    const link = await buildShareLink(opened as OpenedSource, settings, BASE);
    if (!link.ok) throw new Error(link.reason);
    const { source, overrides } = parseRoute(link.url);
    const carried = source?.kind === "shared" ? (await decodeShare(source.payload)).settings : overrides;
    expect(carried).toEqual({ opening: true, liveTop: true });
  });

  // The extension's Studio opens file: URLs; anywhere else such a link would open nothing.
  it("carries a local file: URL's text in the hash, not the URL", async () => {
    const opened = { ref: { kind: "url", url: "file:///home/me/notes.md" }, name: "notes.md", text: "# N" };
    const link = await buildShareLink(opened as OpenedSource, DEFAULT_SETTINGS, BASE);
    if (!link.ok) throw new Error(link.reason);
    expect(parseRoute(link.url).source?.kind).toBe("shared");
  });

  it.each([
    ["binary format", { name: "photo.png", text: "x" }],
    ["path traversal only", { name: "../", text: "x" }],
  ])("refuses to encode a %s", async (_label, payload) => {
    await expect(encodeShare(payload)).rejects.toBeInstanceOf(ShareError);
  });

  it("strips directories and control characters from names", () => {
    expect(sanitizeShareName("a/b\\c\u0007.md")).toBe("c.md");
    expect(sanitizeShareName(42)).toBeNull();
  });

  it.each([
    ["empty", async () => ""],
    ["not base64url", async () => "abc$def"],
    ["not deflate", async () => "AAAAAAAA"],
    ["not JSON", () => deflate("hello")],
    ["wrong version", () => deflate(JSON.stringify({ v: 2, n: "a.md", x: "" }))],
    ["binary name", () => deflate(JSON.stringify({ v: 1, n: "a.exe", x: "" }))],
    ["decompression bomb", () => deflate(JSON.stringify({ v: 1, n: "a.md", x: "a".repeat(MAX_INFLATED_BYTES) }))],
  ])("rejects a %s payload", async (_label, make) => {
    await expect(decodeShare(await make())).rejects.toBeInstanceOf(ShareError);
  });
});

describe("routes", () => {
  it.each<[string, Partial<Route>]>([
    ["?example=svg-chart&autoplay=1", { source: { kind: "example", id: "svg-chart" }, autoplay: true }],
    [
      `?src=${encodeURIComponent("https://a.example/doc.pdf")}`,
      { source: { kind: "url", url: "https://a.example/doc.pdf" } },
    ],
    ["?round=1", { source: null, watch: true, round: true }],
    ["?import=1", { source: null, import: true }],
    ["?from=bookmarklet", { source: { kind: "handoff" } }],
    ["?example=a&agents=12&speed=2&lang=ja-JP", { overrides: { agents: 12, speed: 2, locale: "ja" } }],
    ["?example=a&opening=1&live-top=1", { overrides: { opening: true, liveTop: true } }],
  ])("parses %s", (search, expected) => {
    expect(parseRoute(`${BASE}${search}`)).toMatchObject(expected);
  });

  it("serializes routes back to the same route", () => {
    const route: Route = {
      source: { kind: "shared", payload: "abc_-123" },
      autoplay: true,
      watch: true,
      round: false,
      import: false,
      overrides: { seed: 7, sound: false },
    };
    const href = routeToUrl(route, BASE);
    expect(new URL(href).hash).toBe("#d=abc_-123");
    expect(parseRoute(href)).toEqual(route);
  });

  it("lists every setting parameter in the README", () => {
    const params = [...new URL(routeToUrl({ overrides: DEFAULT_SETTINGS }, BASE)).searchParams.keys()];
    const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");
    const row = readme.split("\n").find((line) => line.endsWith("| Settings for this visit only. |")) ?? "";
    const listed = [...(row.split("|")[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(params.sort());
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "https://user:pw@a.example/", "file:///etc/passwd"])(
    "never routes to %s",
    (src) => {
      expect(parseRoute(`${BASE}?src=${encodeURIComponent(src)}`).source).toBeNull();
    },
  );

  it("accepts file: sources only when the extension allows them", () => {
    expect(normalizeSourceUrl("file:///tmp/a.pdf", BASE, { allowFileUrls: true })).toBe("file:///tmp/a.pdf");
  });

  it("ignores invalid ids and overrides without throwing", () => {
    const route = parseRoute(`${BASE}?example=../../etc&agents=9999&theme=neon`);
    expect(route.source).toBeNull();
    expect(route.overrides).toEqual({});
    expect(parseRoute(`${BASE}#d=not*valid`).source).toEqual({ kind: "shared", payload: "" });
  });
});

describe("settings impact", () => {
  it.each([
    [{}, "none"],
    [{ speed: 2 }, "live"],
    [{ speed: 2, agents: 8 }, "rebuild"],
    [{ agents: 8, theme: "dark" }, "reload"],
  ] as const)("classifies %o as %s", (change, impact) => {
    expect(impactOf(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ...change })).toBe(impact);
  });

  it("gives a muted player the chosen pack, volume and beat hits, since unmuting is live", () => {
    const muted = { ...DEFAULT_SETTINGS, sound: false, soundPack: "8bit" as const, volume: 0.4, beatHits: true };
    expect(impactOf(muted, { ...muted, sound: true })).toBe("live");
    expect(playerOptionsFrom(muted, "en").sound).toEqual({
      enabled: false,
      pack: "8bit",
      volume: 0.4,
      beatSync: "all",
    });
  });
});
