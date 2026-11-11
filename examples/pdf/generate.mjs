#!/usr/bin/env node
// Generates examples/pdf/brochure.pdf: a two-page A4 brochure written for this repository
// (headings, paragraphs, a CJK line, a table, a vector chart with a rotated axis label,
// a raster figure and two-column notes). Chromium prints our own HTML to PDF.
// The chart values are invented for this fixture and labelled as such; they are not measurements.
//
// Usage: node examples/pdf/generate.mjs [--out path] [--chrome path]
// Chromium: --chrome, $SWARMLOOM_CHROME, ~/bin/chromium, else Playwright's own build.
// Fonts come from the machine (Liberation/DejaVu/Noto CJK here), so other machines may
// produce slightly different bytes; the committed file is the reference sample.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { out: { type: "string", default: join(here, "brochure.pdf") }, chrome: { type: "string" } },
});
const MAX_BYTES = 300 * 1024;

function chromePath() {
  const candidates = [values.chrome, process.env.SWARMLOOM_CHROME, join(homedir(), "bin", "chromium")];
  return candidates.find((p) => p && existsSync(p));
}

const formats = [
  ["Markdown", "remark AST, themed HTML", "typed text"],
  ["DOCX", "paged HTML", "typed text, swept images"],
  ["PDF", "pdf.js page bitmap", "typed line crops"],
  ["SVG", "path geometry", "pen and trace"],
  ["Slides", "positioned frames", "boxes, then text"],
  ["3D model", "WebGL patches", "vertices, edges, faces"],
];

// Invented example values (not benchmark results), labelled neutrally so the chart claims nothing.
const bars = [
  ["A", 42],
  ["B", 58],
  ["C", 71],
  ["D", 36],
  ["E", 64],
  ["F", 49],
];

/** Illustrative vector bar chart with a dashed trend path; printed by Chromium as PDF paths. */
function chart() {
  const w = 560;
  const h = 230;
  const left = 64;
  const bottom = 190;
  const top = 20;
  const step = (w - left - 20) / bars.length;
  const y = (v) => bottom - ((bottom - top) * v) / 80;
  const grid = [0, 20, 40, 60, 80]
    .map(
      (v) =>
        `<line x1="${left}" x2="${w - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#d9d9e3" stroke-width="1"/>` +
        `<text x="${left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#555566">${v}</text>`,
    )
    .join("");
  const colors = ["#5B5BF7", "#FF6B5B", "#14B8A6", "#F5A524", "#D946EF", "#3BA7F5"];
  const rects = bars
    .map(([label, v], i) => {
      const x = left + i * step + step * 0.2;
      const bw = step * 0.6;
      return (
        `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(bottom - y(v)).toFixed(1)}" rx="3" fill="${colors[i]}"/>` +
        `<text x="${(x + bw / 2).toFixed(1)}" y="${bottom + 16}" text-anchor="middle" font-size="11" fill="#333344">${label}</text>`
      );
    })
    .join("");
  const pts = bars.map(([, v], i) => [left + i * step + step / 2, y(v * 0.8 + 6)]);
  const curve = pts
    .map(([px, py], i) => {
      if (i === 0) return `M${px.toFixed(1)} ${py.toFixed(1)}`;
      const [qx, qy] = pts[i - 1];
      const mx = (qx + px) / 2;
      return `C${mx.toFixed(1)} ${qy.toFixed(1)} ${mx.toFixed(1)} ${py.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${grid}
    <line x1="${left}" x2="${left}" y1="${top - 6}" y2="${bottom}" stroke="#0b0b12" stroke-width="1.5"/>
    <line x1="${left}" x2="${w - 10}" y1="${bottom}" y2="${bottom}" stroke="#0b0b12" stroke-width="1.5"/>
    ${rects}
    <path d="${curve}" fill="none" stroke="#0b0b12" stroke-width="2" stroke-dasharray="6 4"/>
    <text transform="translate(18 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333344">example value</text>
  </svg>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SwarmLoom field guide</title>
<style>
  @page { size: A4; margin: 18mm 17mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.5 "Liberation Serif", "DejaVu Serif", serif; color: #1d1d27; }
  h1, h2, h3, th, .kicker, .caption, footer { font-family: "Liberation Sans", "DejaVu Sans", sans-serif; }
  .kicker { color: #5b5bf7; font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4pt; }
  h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 6pt; color: #0b0b12; }
  .lede { font-size: 13pt; color: #3a3a48; margin: 0 0 4pt; }
  .zh { font-family: "Noto Sans CJK SC", sans-serif; font-size: 12pt; color: #5b5bf7; margin: 0 0 14pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; color: #0b0b12; }
  p { margin: 0 0 7pt; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0 4pt; font-size: 9.5pt; }
  th { background: #ececfd; text-align: left; font-weight: 700; }
  th, td { border: 0.75pt solid #b9b9cc; padding: 4pt 6pt; }
  figure { margin: 12pt 0 0; }
  figure img { display: block; width: 100%; height: auto; border-radius: 4pt; }
  .caption { font-size: 8.5pt; color: #555566; margin-top: 4pt; }
  .page2 { break-before: page; }
  .cols { column-count: 2; column-gap: 18pt; }
  hr { border: 0; border-top: 1.5pt solid #ff6b5b; width: 64pt; margin: 14pt 0 10pt; }
  footer { font-size: 8pt; color: #77778a; margin-top: 16pt; }
</style></head>
<body>
  <p class="kicker">Field guide</p>
  <h1>SwarmLoom</h1>
  <p class="lede">Watch a swarm of cursors weave it into being.</p>
  <p class="zh">让一群光标，把它织出来。</p>
  <p>SwarmLoom turns a page, a document or a model into a build you can watch. A small crowd of cursors
  takes the finished result apart into boxes, lines of text, paths and pictures, then puts it back together
  in reading order: frames first, then the words inside them, then the details.</p>
  <p>Every cursor is an independent worker. When one finishes a task it picks the nearest open one, so the
  swarm spreads across the page and gathers where the work is. The timing comes from a seeded clock, which
  means the same file and the same seed always produce the same film, frame for frame.</p>
  <h2>One engine, many formats</h2>
  <p>Each format has a small adapter that reads the file and describes what to build. The engine never needs
  to know where a layer came from.</p>
  <table>
    <thead><tr><th>Format</th><th>Adapter reads</th><th>Build style</th></tr></thead>
    <tbody>${formats.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  <figure>
    <img id="loom" alt="Woven pattern">
    <div class="caption">Figure 1. A woven test pattern drawn for this guide.</div>
  </figure>

  <section class="page2">
    <h2>Illustrative vector chart</h2>
    <p>Grid, bars and a dashed trend path return as separate layers. Values are invented for this PDF fixture.</p>
    ${chart()}
    <p class="caption">Figure 2. Illustrative values, not benchmark results.</p>
    <hr>
    <h2>Notes for authors</h2>
    <div class="cols">
      <p>Keep headings short. The swarm types them at a larger size and lets them grow as they are written,
      so a long heading takes a while to land.</p>
      <p>Tables are drawn as a grid first, then filled row by row. Very wide tables still work, but they are
      easier to follow when each cell holds a few words.</p>
      <p>Pictures are swept in from top to bottom once their frame is placed. Large photos look best when
      they have a little space around them.</p>
      <p>Exported films keep the sound in step with the picture, because both come from the same list of
      events recorded during the build.</p>
    </div>
    <footer>SwarmLoom sample document. Written for the SwarmLoom repository and released under the MIT license.</footer>
  </section>
<script>
  // Raster figure: a deterministic woven pattern painted on a canvas and embedded as PNG.
  const c = document.createElement("canvas");
  c.width = 480; c.height = 150;
  const g = c.getContext("2d");
  const colors = ["#5B5BF7", "#FF6B5B", "#14B8A6", "#F5A524", "#D946EF", "#3BA7F5"];
  g.fillStyle = "#fafafc"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 24; i++) { g.fillStyle = colors[i % 6]; g.globalAlpha = 0.85; g.fillRect(i * 20 + 4, 0, 10, c.height); }
  for (let j = 0; j < 8; j++) { g.fillStyle = colors[(j + 2) % 6]; g.globalAlpha = 0.6; g.fillRect(0, j * 19 + 5, c.width, 8); }
  document.getElementById("loom").src = c.toDataURL("image/png");
</script>
</body></html>`;

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("loom")?.complete === true);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: values.out, format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true });
} finally {
  await browser.close();
}

const size = statSync(values.out).size;
console.log(`wrote ${values.out} (${(size / 1024).toFixed(1)} KB)`);
if (size > MAX_BYTES) {
  console.error(`sample exceeds ${MAX_BYTES / 1024} KB; simplify the content`);
  process.exitCode = 1;
}
