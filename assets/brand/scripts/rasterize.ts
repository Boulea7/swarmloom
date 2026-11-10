// Exports every PNG listed in contracts/brand.md by rendering the brand SVGs with headless Chromium.
// Usage: node assets/brand/scripts/rasterize.ts [--only file,file]
// Run scripts/generate.ts first: the icons are rendered from the committed SVG files.
// Chromium: $SWARMLOOM_CHROME, else ~/bin/chromium, else Playwright's bundled build.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture, withBrowser } from "./lib/browser.ts";
import { loadPalette } from "./lib/palette.ts";
import { BRAND_DIR } from "./lib/paths.ts";
import { decodePng, isOpaque } from "./lib/png.ts";
import { rasterJobs } from "./lib/rasters.ts";

const onlyFlag = process.argv.indexOf("--only");
const only = onlyFlag >= 0 ? process.argv[onlyFlag + 1]?.split(",") : undefined;
const jobs = rasterJobs(loadPalette()).filter((j) => !only || only.includes(j.file));
if (jobs.length === 0) {
  console.error(`no raster job matches ${only?.join(",")}`);
  process.exit(2);
}

await withBrowser(async (browser) => {
  for (const job of jobs) {
    const png = await capture(browser, {
      html: job.html(),
      width: job.width,
      height: job.height,
      transparent: job.transparent,
    });
    // Guard the alpha policy: maskable and social images must be opaque, icons must keep clear corners.
    const bmp = decodePng(png);
    if (bmp.width !== job.width || bmp.height !== job.height) {
      throw new Error(`${job.file}: captured ${bmp.width}x${bmp.height}, expected ${job.width}x${job.height}`);
    }
    if (!job.transparent && !isOpaque(bmp)) throw new Error(`${job.file}: expected an opaque image`);
    writeFileSync(join(BRAND_DIR, job.file), png);
    console.log(`${job.file} ${job.width}x${job.height} ${png.length} B`);
  }
});
