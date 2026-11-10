import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vectorAssets } from "../scripts/lib/catalog.ts";
import { contrast } from "../scripts/lib/color.ts";
import { CURSOR_BOX, TAG_MIN_CONTRAST, tagFill } from "../scripts/lib/cursor.ts";
import { CURSOR_AT, MARK_GRID, markStyles } from "../scripts/lib/mark.ts";
import { keyframes, MOTION_QUERY } from "../scripts/lib/motion.ts";
import { loadPalette, parsePalette } from "../scripts/lib/palette.ts";
import { BRAND_DIR } from "../scripts/lib/paths.ts";
import { alphaAt, decodePng, isOpaque, pngSize } from "../scripts/lib/png.ts";
import { ICON_SIZES, rasterJobs } from "../scripts/lib/rasters.ts";

const palette = loadPalette();
const read = (file: string) => readFileSync(join(BRAND_DIR, file));

/** Files contracts/brand.md requires in assets/brand. */
const CONTRACT_FILES = [
  "logo.svg",
  "logo-dark.svg",
  "wordmark.svg",
  "wordmark-dark.svg",
  "favicon.svg",
  ...ICON_SIZES.map((s) => `icon-${s}.png`),
  "icon-maskable-512.png",
  "social-preview.png",
  "og-zh.png",
  "og-en.png",
  "palette.json",
];

describe("palette.json", () => {
  it("matches the brand contract", () => {
    expect(palette.primary).toBe("#5B5BF7");
    expect(palette.accent).toBe("#FF4F7B");
    expect(palette.cursors.map((c) => c.hex)).toEqual([
      "#5B5BF7",
      "#FF6B5B",
      "#14B8A6",
      "#F5A524",
      "#D946EF",
      "#3BA7F5",
      "#84CC16",
      "#9B5CF6",
      "#F43F5E",
      "#0EA5E9",
      "#22C55E",
      "#FB923C",
    ]);
    expect(palette.tagline.zh).toBe("让一群光标，把它织出来。");
  });

  it.each([
    ["a non-object", [], "$ must be an object"],
    ["a lowercase hex", { primary: "#5b5bf7" }, "$.primary"],
    ["too few cursors", { cursors: [{ name: "x", hex: "#000000" }] }, "$.cursors"],
    ["a zero tag radius", { nameTag: { ...palette.nameTag, radius: 0 } }, "$.nameTag.radius"],
  ])("rejects %s", (_label, patch, message) => {
    const input = Array.isArray(patch) ? patch : { ...palette, ...patch };
    expect(() => parsePalette(input)).toThrow(message);
  });

  it("keeps white name-tag text legible on every cursor colour", () => {
    for (const { hex } of palette.cursors)
      expect(contrast(tagFill(hex), "#FFFFFF")).toBeGreaterThanOrEqual(TAG_MIN_CONTRAST);
  });
});

describe("vector assets", () => {
  const assets = vectorAssets(palette);

  it("are committed exactly as the generator produces them (run scripts/generate.ts)", () => {
    for (const { file, svg } of assets) expect(read(file).toString("utf8"), file).toBe(svg);
  });

  it("are deterministic", () => {
    expect(vectorAssets(palette)).toEqual(assets);
  });

  it("are self-contained: no scripts, event handlers, external references or raster payloads", () => {
    for (const { file, svg } of assets) {
      expect(svg, file).not.toMatch(/<script|<foreignObject|\son[a-z]+=|javascript:/i);
      expect(svg, file).not.toMatch(/(?:href|src)="(?!#)/);
      expect(svg, file).not.toMatch(/url\((?!#)/);
      expect(svg, file).not.toMatch(/@import/);
    }
  });

  it("ship ten light/dark card pairs and two hero banners under budget", () => {
    const cards = assets.filter((a) => a.file.startsWith("cards/"));
    expect(cards).toHaveLength(20);
    for (const id of new Set(cards.map((c) => c.file.replace(/-(light|dark)\.svg$/, "")))) {
      expect(cards.map((c) => c.file)).toEqual(expect.arrayContaining([`${id}-light.svg`, `${id}-dark.svg`]));
    }
    for (const scheme of ["light", "dark"]) {
      const hero = assets.find((a) => a.file === `hero-${scheme}.svg`)?.svg ?? "";
      expect(Buffer.byteLength(hero)).toBeLessThan(60 * 1024);
      expect(hero).toContain('viewBox="0 0 1280 420"');
      expect(hero).toContain("animation-duration:8s");
      // Every animation rule lives inside the no-preference query, so reduced motion shows the final frame.
      const motion = hero.indexOf(MOTION_QUERY);
      expect(motion).toBeGreaterThan(0);
      expect(hero.slice(0, motion)).not.toMatch(/animation|@keyframes/);
    }
  });
});

describe("keyframes", () => {
  it("merges frames that share a percentage and writes per-segment easing", () => {
    const css = keyframes("k", [
      { at: 0, props: { opacity: "0" }, ease: "linear" },
      { at: 1, props: { opacity: "1" } },
      { at: 1, props: { transform: "none" } },
    ]);
    expect(css).toBe("@keyframes k{0%{opacity:0;animation-timing-function:linear}100%{opacity:1;transform:none}}");
  });

  it("rejects open loops and out-of-range frames", () => {
    expect(() => keyframes("k", [{ at: 0, props: {} }])).toThrow("must define 0% and 100%");
    expect(() => keyframes("k", [{ at: 1.2, props: {} }])).toThrow("outside 0..1");
  });
});

describe("raster assets", () => {
  const jobs = rasterJobs(palette);

  it("cover every file the contract lists, at the listed sizes", () => {
    for (const file of CONTRACT_FILES) expect(statSync(join(BRAND_DIR, file)).size, file).toBeGreaterThan(0);
    for (const job of jobs) expect(pngSize(read(job.file)), job.file).toEqual({ width: job.width, height: job.height });
    expect(pngSize(read("social-preview.png"))).toEqual({ width: 1280, height: 640 });
    expect(pngSize(read("og-zh.png"))).toEqual({ width: 1200, height: 630 });
  });

  it("keep icon corners transparent and the maskable and social images opaque", () => {
    for (const job of jobs) {
      const bmp = decodePng(read(job.file));
      if (job.transparent) {
        expect(alphaAt(bmp, 0, 0), job.file).toBe(0);
        expect(alphaAt(bmp, bmp.width >> 1, bmp.height >> 1), job.file).toBe(255);
      } else {
        expect(isOpaque(bmp), job.file).toBe(true);
      }
    }
  });

  it("keep the maskable artwork inside the 80% safe zone", () => {
    // The cursor is the only element that must survive the mask; threads may run to the edge.
    const { contentScale } = markStyles(palette).maskable;
    const half = MARK_GRID / 2;
    const at = (v: number) => half + (v - half) * contentScale;
    const corners = [
      [CURSOR_BOX.x, CURSOR_BOX.y],
      [CURSOR_BOX.x + CURSOR_BOX.w, CURSOR_BOX.y],
      [CURSOR_BOX.x, CURSOR_BOX.y + CURSOR_BOX.h],
      [CURSOR_BOX.x + CURSOR_BOX.w, CURSOR_BOX.y + CURSOR_BOX.h],
    ].map(([x = 0, y = 0]) => [at(x + CURSOR_AT.x), at(y + CURSOR_AT.y)] as const);
    for (const [x, y] of corners) expect(Math.hypot(x - half, y - half)).toBeLessThanOrEqual(half * 0.8);
  });

  it("rejects files that are not PNG", () => {
    expect(() => pngSize(read("logo.svg"))).toThrow("not a PNG");
  });
});

describe("repository budget", () => {
  it("keeps generated brand assets under 1.5 MB", () => {
    const sizeOf = (dir: string): number =>
      readdirSync(dir).reduce((sum, name) => {
        const path = join(dir, name);
        const st = statSync(path);
        if (st.isDirectory()) return name === "node_modules" ? sum : sum + sizeOf(path);
        return /\.(svg|png|json)$/.test(name) ? sum + st.size : sum;
      }, 0);
    expect(sizeOf(BRAND_DIR)).toBeLessThan(1.5 * 1024 * 1024);
  });
});
