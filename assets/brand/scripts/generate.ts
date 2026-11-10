// Writes every vector asset (marks, lockups, favicon, hero banners, feature cards) into assets/brand.
// Usage: node assets/brand/scripts/generate.ts [--check]
//   --check  write nothing; exit 1 when a committed SVG differs from the generator output.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { vectorAssets } from "./lib/catalog.ts";
import { loadPalette } from "./lib/palette.ts";
import { BRAND_DIR } from "./lib/paths.ts";

const check = process.argv.includes("--check");
const assets = vectorAssets(loadPalette());
const stale: string[] = [];

for (const { file, svg } of assets) {
  const path = join(BRAND_DIR, file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (current === svg) continue;
  stale.push(file);
  if (check) continue;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
}

// Cards that no longer exist in the catalogue would otherwise linger in git.
const known = new Set(assets.map((a) => a.file));
const cardsDir = join(BRAND_DIR, "cards");
const orphans = (existsSync(cardsDir) ? readdirSync(cardsDir) : [])
  .map((f) => `cards/${f}`)
  .filter((f) => f.endsWith(".svg") && !known.has(f));

if (check) {
  const problems = [...stale.map((f) => `out of date: ${f}`), ...orphans.map((f) => `orphan: ${f}`)];
  if (problems.length > 0) {
    console.error(`${problems.join("\n")}\nRun: node assets/brand/scripts/generate.ts`);
    process.exit(1);
  }
  console.log(`${assets.length} SVG assets up to date`);
} else {
  console.log(`wrote ${stale.length} of ${assets.length} SVG assets`);
  if (orphans.length > 0) console.warn(`orphaned card files (delete them): ${orphans.join(", ")}`);
}
