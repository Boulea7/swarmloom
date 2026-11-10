// Visual QA contact sheets (not committed): renders the generated SVGs the way viewers will see them.
// Usage: node assets/brand/scripts/preview.ts <identity|cards|hero> [light|dark] [times-in-seconds,...] [--out dir]
// Writes PNGs to --out (default: $TMPDIR/swarmloom-brand-preview) and prints their paths.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { capture, page, withBrowser } from "./lib/browser.ts";
import { CARD, CARDS } from "./lib/cards/index.ts";
import { HERO } from "./lib/hero.ts";
import { BRAND_DIR } from "./lib/paths.ts";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = outFlag >= 0 ? (args[outFlag + 1] ?? "") : join(tmpdir(), "swarmloom-brand-preview");
const [mode, schemeArg, timesArg] = args.filter((_, i) => outFlag < 0 || (i !== outFlag && i !== outFlag + 1));
const scheme = schemeArg === "dark" ? "dark" : "light";
const pageBg = scheme === "dark" ? "#0D1117" : "#FFFFFF";

const read = (file: string) => readFileSync(join(BRAND_DIR, file), "utf8");
const dataUrl = (mime: string, bytes: Buffer | string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const svgImg = (file: string, w: number, h: number) =>
  `<img src="${dataUrl("image/svg+xml", read(file))}" width="${w}" height="${h}">`;

async function save(name: string, png: Buffer): Promise<void> {
  const path = join(outDir, name);
  writeFileSync(path, png);
  console.log(path);
}

/** Marks at icon sizes on light and dark, 8x pixel zooms of the small rasters, the maskable safe zone. */
async function identity(browser: Browser): Promise<void> {
  const sizes = [16, 32, 48, 128];
  const zoomed: string[] = [];
  for (const [file, bg] of [
    ["favicon.svg", "#FFFFFF"],
    ["favicon.svg", "#202124"],
    ["logo.svg", "#FFFFFF"],
    ["logo-dark.svg", "#0D1117"],
  ] as const) {
    for (const s of [16, 32]) {
      const png = await capture(browser, { html: page(svgImg(file, s, s), { background: bg }), width: s, height: s });
      zoomed.push(
        `<figure><img src="${dataUrl("image/png", png)}" width="${s * (s === 16 ? 8 : 4)}" style="image-rendering:pixelated"><figcaption>${file} ${s}px on ${bg}</figcaption></figure>`,
      );
    }
  }
  const row = (bg: string, files: string[]) =>
    `<div class="row" style="background:${bg}">${files.map((f) => sizes.map((s) => svgImg(f, s, s)).join("")).join("<i></i>")}</div>`;
  const safe = `<div class="row" style="background:#E9E9EF"><div style="position:relative;width:192px;height:192px;overflow:hidden">${svgImg("logo-maskable.svg", 192, 192)}<div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(233,233,239,.82)"></div><div style="position:absolute;inset:19.2px;border-radius:50%;outline:1px dashed #FF4F7B"></div></div><div style="width:192px;height:192px;border-radius:38%;overflow:hidden">${svgImg("logo-maskable.svg", 192, 192)}</div></div>`;
  const html = page(
    [
      row("#FAFAFC", ["logo.svg", "favicon.svg"]),
      row("#0B0B12", ["logo-dark.svg", "favicon.svg"]),
      `<div class="row" style="background:#FAFAFC">${svgImg("wordmark.svg", 0, 64).replace('width="0" ', "")}${svgImg("wordmark.svg", 0, 24).replace('width="0" ', "")}</div>`,
      `<div class="row" style="background:#0B0B12">${svgImg("wordmark-dark.svg", 0, 64).replace('width="0" ', "")}${svgImg("wordmark-dark.svg", 0, 24).replace('width="0" ', "")}</div>`,
      safe,
      `<div class="row zoom">${zoomed.join("")}</div>`,
    ].join(""),
    {
      background: "#FFFFFF",
      css: ".row{display:flex;gap:16px;align-items:center;padding:14px;flex-wrap:wrap}.row i{width:24px}figure{margin:0;font:11px monospace;color:#555}.zoom{background:#F2F2F5}",
    },
  );
  await save("identity.png", await capture(browser, { html, width: 1100, height: 1100 }));
}

/** Cards of one scheme (all, or the comma-separated ids in the third argument), two per row at 1x. */
async function cards(browser: Browser): Promise<void> {
  const only = timesArg?.split(",");
  const list = CARDS.filter((c) => !only || only.includes(c.id));
  const imgs = list.map((c) => svgImg(`cards/${c.id}-${scheme}.svg`, CARD.width, CARD.height)).join("");
  const w = CARD.width * 2 + 48;
  const h = Math.ceil(list.length / 2) * (CARD.height + 16) + 16;
  const html = page(
    `<div style="display:grid;grid-template-columns:repeat(2,${CARD.width}px);gap:16px;padding:16px">${imgs}</div>`,
    {
      background: pageBg,
    },
  );
  await save(
    `cards-${scheme}${only ? `-${only.join("-")}` : ""}.png`,
    await capture(browser, { html, width: w, height: h, scale: 1 }),
  );
}

/** Hero frames at the given times (seconds), plus the reduced-motion render. */
async function hero(browser: Browser): Promise<void> {
  const times = (timesArg ?? "0,0.6,1.4,2.2,3,3.8,4.6,5.4,6.6,7.6").split(",").map(Number);
  const svg = read(`hero-${scheme}.svg`);
  const html = page(svg, { background: pageBg });
  for (const t of times) {
    if (!Number.isFinite(t) || t < 0 || t > HERO.seconds) throw new Error(`bad time ${t}`);
    await save(
      `hero-${scheme}-${t}.png`,
      await capture(browser, { html, width: HERO.width, height: HERO.height, atMs: t * 1000 }),
    );
  }
  await save(
    `hero-${scheme}-reduced.png`,
    await capture(browser, { html, width: HERO.width, height: HERO.height, reducedMotion: true }),
  );
}

const modes: Record<string, (b: Browser) => Promise<void>> = { identity, cards, hero };
const run = mode ? modes[mode] : undefined;
if (!run || !outDir) {
  console.error("usage: preview.ts <identity|cards|hero> [light|dark] [times] [--out dir]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
await withBrowser(run);
