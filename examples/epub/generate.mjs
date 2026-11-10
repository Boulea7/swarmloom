#!/usr/bin/env node
// Generates the EPUB sample of this folder from scratch: loom-notes.epub, an EPUB 3 book with a
// navigation document and an EPUB 2 NCX, a cover image, a style sheet, an inline picture and three
// chapters (one in Chinese). The XML is written here and packed with ../odf/pack.mjs (mimetype
// first and stored, as OCF requires).
//
// Usage: node examples/epub/generate.mjs [--out dir]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { weave, zip } from "../odf/pack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string", default: here } } });
const MAX_BYTES = 200 * 1024;

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

const container = `${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const chapters = [
  { id: "cover", file: "text/cover.xhtml", title: "Cover" },
  { id: "ch1", file: "text/ch1.xhtml", title: "Warp and Weft" },
  { id: "ch2", file: "text/ch2.xhtml", title: "织机笔记" },
  { id: "ch3", file: "text/ch3.xhtml", title: "Finishing" },
];

const opf = `${HEAD}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5f1d3a52-6f0e-4d7b-9b9e-2a7c1c0e5a01</dc:identifier>
    <dc:title>Loom Notes</dc:title>
    <dc:creator>SwarmLoom samples</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="pattern" href="images/pattern.png" media-type="image/png"/>
${chapters.map((c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
${chapters.map((c) => `    <itemref idref="${c.id}"/>`).join("\n")}
  </spine>
</package>
`;

const nav = `${HEAD}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="text/ch1.xhtml">Warp and Weft</a>
        <ol><li><a href="text/ch1.xhtml#threads">Counting threads</a></li></ol>
      </li>
      <li><a href="text/ch2.xhtml">织机笔记</a></li>
      <li><a href="text/ch3.xhtml">Finishing</a></li>
    </ol>
  </nav>
</body>
</html>
`;

const ncx = `${HEAD}<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:5f1d3a52-6f0e-4d7b-9b9e-2a7c1c0e5a01"/></head>
  <docTitle><text>Loom Notes</text></docTitle>
  <navMap>
${chapters
  .slice(1)
  .map(
    (c, i) =>
      `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${c.title}</text></navLabel><content src="${c.file}"/></navPoint>`,
  )
  .join("\n")}
  </navMap>
</ncx>
`;

const css = `@charset "utf-8";
html { font-size: 100%; }
body { font-family: Georgia, "Times New Roman", serif; color: #1f2430; }
h1 { font-family: Calibri, Arial, sans-serif; color: #4338ca; border-bottom: 2px solid #c7d2fe; padding-bottom: .2em; }
h2 { color: #b45309; }
p.lead { font-size: 1.15em; color: #374151; }
.note { background: #fff7ed url("../images/pattern.png") no-repeat right top; background-size: 48px 48px; border-left: 4px solid #fb923c; padding: .6em 1em; }
figure { margin: 1em 0; text-align: center; }
figcaption { font-size: .85em; color: #6b7280; }
table { width: 100%; }
th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; }
th { background: #eef2ff; }
.cjk { font-family: SimSun, serif; line-height: 1.9; }
.fixed-badge { position: fixed; top: 0; right: 0; }
@media print { body { color: black; } }
@import url("https://example.invalid/remote.css");
`;

function page(title, body, extraHead = "") {
  return `${HEAD}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>${extraHead}
</head>
<body>
${body}
</body>
</html>
`;
}

const cover = page("Cover", `  <div class="cover"><img src="../images/cover.png" alt="Loom Notes"/></div>`);

const ch1 = page(
  "Warp and Weft",
  `  <h1>Warp and Weft</h1>
  <p class="lead">Every cloth starts with two families of threads: the warp, stretched along the loom, and the weft, carried across it.</p>
  <p>A simple <em>plain weave</em> lifts every other warp thread, passes the weft, then swaps. Change the lifting order and the cloth changes with it: <strong>twill</strong> shifts by one thread each pass, <strong>satin</strong> skips several.</p>
  <figure>
    <img src="../images/pattern.png" alt="A woven pattern" width="160" height="160"/>
    <figcaption>Figure 1. Warp (blue) and weft (coral) crossing.</figcaption>
  </figure>
  <h2 id="threads">Counting threads</h2>
  <ul>
    <li>Ends per centimetre: the density of the warp.</li>
    <li>Picks per centimetre: the density of the weft.</li>
    <li>Sett: how the two are balanced.</li>
  </ul>
  <table>
    <thead><tr><th>Weave</th><th>Float</th><th>Hand</th></tr></thead>
    <tbody>
      <tr><td>Plain</td><td>1</td><td>Crisp</td></tr>
      <tr><td>Twill 2/2</td><td>2</td><td>Supple</td></tr>
      <tr><td>Satin 5</td><td>4</td><td>Smooth</td></tr>
    </tbody>
  </table>
  <p class="note">Tip: keep the tension even. A loose warp thread shows as a ridge in the finished cloth.</p>
  <p>See the <a href="ch3.xhtml">finishing chapter</a> for washing and pressing.</p>
  <script>document.title = "never run";</script>`,
);

const ch2 = page(
  "织机笔记",
  `  <h1>织机笔记</h1>
  <div class="cjk" lang="zh-CN">
    <p>经线沿着织机绷紧，纬线在经线之间来回穿梭。两组线交错，便织成了布。</p>
    <p>平纹最简单：每次提起一半经线，投梭，再换另一半。斜纹每一梭错开一根线，缎纹则跳过数根，使布面更加光滑。</p>
    <p class="note">提示：经线张力要均匀，松弛的经线会在布面上留下凸起的痕迹。</p>
  </div>`,
);

const ch3 = page(
  "Finishing",
  `  <h1>Finishing</h1>
  <p>Off the loom, cloth is still open and a little stiff. Washing lets the threads bloom into each other; pressing sets the surface.</p>
  <blockquote><p>Weave slowly, finish patiently.</p></blockquote>
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60">
    <rect x="0" y="0" width="240" height="60" rx="8" fill="#eef2ff"/>
    <path d="M10 30 C 50 0, 90 60, 130 30 S 210 0, 230 30" stroke="#5b5bf7" stroke-width="4" fill="none"/>
  </svg>`,
  `\n  <style>blockquote { font-style: italic; color: #4338ca; margin-left: 2em; }</style>`,
);

const entries = [
  { name: "mimetype", data: "application/epub+zip", store: true },
  { name: "META-INF/container.xml", data: container },
  { name: "OEBPS/content.opf", data: opf },
  { name: "OEBPS/nav.xhtml", data: nav },
  { name: "OEBPS/toc.ncx", data: ncx },
  { name: "OEBPS/styles/book.css", data: css },
  { name: "OEBPS/images/cover.png", data: weave(300, 450, ["#1E1B4B", "#312E81", "#A5B4FC", "#FB923C"]), store: true },
  { name: "OEBPS/images/pattern.png", data: weave(96, 96), store: true },
  { name: "OEBPS/text/cover.xhtml", data: cover },
  { name: "OEBPS/text/ch1.xhtml", data: ch1 },
  { name: "OEBPS/text/ch2.xhtml", data: ch2 },
  { name: "OEBPS/text/ch3.xhtml", data: ch3 },
];

const bytes = zip(entries);
if (bytes.length >= MAX_BYTES)
  throw new Error(`loom-notes.epub is ${bytes.length} bytes; samples must stay under ${MAX_BYTES}`);
writeFileSync(join(values.out, "loom-notes.epub"), bytes);
console.log(`loom-notes.epub: ${bytes.length} bytes`);
