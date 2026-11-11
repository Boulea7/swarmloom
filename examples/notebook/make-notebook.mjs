#!/usr/bin/env node
// Writes loom-tour.ipynb, an original nbformat 4.5 sample notebook: markdown cells (GFM, a table,
// task lists, Chinese text), Python code cells with stdout, stderr (a carriage-return progress
// bar), an execute_result, a DataFrame-style HTML table, a PNG chart drawn below, an ANSI
// traceback, and one cell that was never run. Output is byte-for-byte reproducible for a given
// Node.js zlib.
//
//   node examples/notebook/make-notebook.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

/* ---------------- data ---------------- */

const PALETTE = ["#5B5BF7", "#FF6B5B", "#14B8A6", "#F5A524", "#D946EF", "#3BA7F5", "#84CC16", "#9B5CF6"];
const layers = (n, k = 3) => Math.round(n * k * Math.log2(n + 1) * 10) / 10;
const speeds = Array.from({ length: 8 }, (_, i) => ({ weavers: i + 1, layers: layers(i + 1) }));
const fixed1 = (v) => v.toFixed(1);

/* ---------------- PNG chart ---------------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

function drawChart() {
  const W = 640;
  const H = 260;
  const px = Buffer.alloc(W * H * 3);
  const fill = (x0, y0, x1, y1, color, skip = () => false) => {
    const [r, g, b] = hex(color);
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        if (skip(x, y)) continue;
        const i = (y * W + x) * 3;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
  };
  fill(0, 0, W, H, "#FAFAFC");
  const left = 56;
  const right = W - 24;
  const top = 20;
  const bottom = H - 36;
  const max = 80;
  const yOf = (v) => Math.round(bottom - ((bottom - top) * v) / max);
  for (let v = 20; v <= max; v += 20) fill(left, yOf(v), right, yOf(v) + 1, "#E4E6EF");
  fill(left, bottom, right, bottom + 2, "#A6A9BA");
  fill(left - 2, top, left, bottom + 2, "#A6A9BA");
  // Tick marks on the y axis.
  for (let v = 0; v <= max; v += 20) fill(left - 8, yOf(v), left - 2, yOf(v) + 1, "#A6A9BA");
  const slot = (right - left) / speeds.length;
  const barW = Math.round(slot * 0.62);
  const radius = 5;
  speeds.forEach((s, i) => {
    const x0 = Math.round(left + slot * i + (slot - barW) / 2);
    const x1 = x0 + barW;
    const y0 = yOf(s.layers);
    // Rounded top corners: skip pixels outside the corner circles.
    const skip = (x, y) => {
      if (y >= y0 + radius) return false;
      const cx = x < x0 + radius ? x0 + radius : x >= x1 - radius ? x1 - radius - 1 : null;
      if (cx === null) return false;
      const dy = y0 + radius - y;
      return (x - cx) ** 2 + dy ** 2 > radius ** 2;
    };
    fill(x0, y0, x1, bottom, PALETTE[i], skip);
    // A tick under each bar.
    fill(Math.round((x0 + x1) / 2), bottom + 2, Math.round((x0 + x1) / 2) + 1, bottom + 8, "#A6A9BA");
  });
  return png(W, H, px);
}

/* ---------------- notebook ---------------- */

const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
let cellId = 0;
const id = () => `loom-${(++cellId).toString().padStart(2, "0")}`;
const md = (text) => ({ cell_type: "markdown", id: id(), metadata: {}, source: lines(text) });
const code = (count, text, outputs = []) => ({
  cell_type: "code",
  execution_count: count,
  id: id(),
  metadata: {},
  outputs,
  source: lines(text),
});
const stream = (name, text) => ({ name, output_type: "stream", text: lines(text) });

const E = "\u001b[";
const red = (s) => `${E}0;31m${s}${E}0m`;
const green = (s) => `${E}0;32m${s}${E}0m`;
const num = (s) => `${E}38;5;241m${s}${E}39m`;
const kw = (s) => `${E}38;5;28;01m${s}${E}39;00m`;
const str = (s) => `${E}38;5;124m${s}${E}39m`;

const tableRows = speeds
  .slice(0, 4)
  .map(
    (s, i) =>
      `    <tr>\n      <th>${i}</th>\n      <td>${s.weavers}</td>\n      <td>${fixed1(s.layers)}</td>\n    </tr>\n`,
  )
  .join("");
const tableHtml = `<div>
<style scoped>
    .dataframe tbody tr th { vertical-align: top; }
    .dataframe thead th { text-align: right; }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>weavers</th>
      <th>layers</th>
    </tr>
  </thead>
  <tbody>
${tableRows}  </tbody>
</table>
</div>`;
const tablePlain = [
  "   weavers  layers",
  ...speeds.slice(0, 4).map((s, i) => `${i}  ${String(s.weavers).padStart(7)}  ${fixed1(s.layers).padStart(6)}`),
].join("\n");

const progress = [0, 2, 4, 6, 8]
  .map((n) => `weaving: ${String((n / 8) * 100).padStart(3)}%|${"█".repeat(n)}${" ".repeat(8 - n)}| ${n}/8`)
  .join("\r");

const cells = [
  md(`# Weaving a notebook

This sample notebook was written for **SwarmLoom**. Each code cell is typed, *run*, and then its output appears, the way it would in Jupyter.

- [x] Markdown with GFM: ~~strikethrough~~, tables and task lists
- [x] Code cells with execution counts
- [ ] Interactive widgets (they need a live kernel, so they are not drawn)

The file format is described in the [nbformat documentation](https://nbformat.readthedocs.io/).`),
  code(
    1,
    `import math

PALETTE = [${PALETTE.map((c) => `"${c}"`).join(", ")}]
weavers = ["Ada", "Bo", "Chen", "Dee"]
for i, name in enumerate(weavers, 1):
    print(f"{i}. {name} picks up a thread")`,
    [
      stream(
        "stdout",
        "1. Ada picks up a thread\n2. Bo picks up a thread\n3. Chen picks up a thread\n4. Dee picks up a thread\n",
      ),
    ],
  ),
  code(
    2,
    `def layers(n, k=3):
    """Layers a swarm of n weavers builds in k seconds."""
    return round(n * k * math.log2(n + 1), 1)

layers(8)`,
    [{ data: { "text/plain": [fixed1(layers(8))] }, execution_count: 2, metadata: {}, output_type: "execute_result" }],
  ),
  md(`## Speed by swarm size

| weavers | layers in 3 s |
|--:|--:|
| 1 | ${fixed1(layers(1))} |
| 4 | ${fixed1(layers(4))} |
| 8 | ${fixed1(layers(8))} |

> More weavers build faster, but not in a straight line: they share one canvas.`),
  code(
    3,
    `import pandas as pd

speeds = pd.DataFrame({"weavers": range(1, 9)})
speeds["layers"] = speeds.weavers.map(layers)
speeds.head(4)`,
    [
      {
        data: { "text/html": lines(tableHtml), "text/plain": lines(tablePlain) },
        execution_count: 3,
        metadata: {},
        output_type: "execute_result",
      },
    ],
  ),
  code(
    4,
    `import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6.4, 2.6))
ax.bar(speeds.weavers, speeds.layers, color=PALETTE)
ax.set_ylabel("layers in 3 s")
plt.show()`,
    [
      {
        data: {
          "image/png": `${drawChart().toString("base64")}\n`,
          "text/plain": ["<Figure size 640x260 with 1 Axes>"],
        },
        metadata: {},
        output_type: "display_data",
      },
    ],
  ),
  code(5, `layers(4, k="fast")`, [
    {
      ename: "TypeError",
      evalue: "can't multiply sequence by non-int of type 'float'",
      output_type: "error",
      traceback: [
        red("-".repeat(75)),
        `${red("TypeError")}                                 Traceback (most recent call last)`,
        `Cell ${green("In[5], line 1")}\n${green("----> 1")} layers(${num("4")}, k${num("=")}${str('"fast"')})\n`,
        `Cell ${green("In[2], line 3")}, in ${E}0;36mlayers${E}0;34m(n, k)${E}0m\n${E}1;32m      1${E}0m ${kw("def")} layers(n, k${num("=")}${num("3")}):\n${E}1;32m      2${E}0m     ${str('"""Layers a swarm of n weavers builds in k seconds."""')}\n${green("----> 3")}     ${kw("return")} round(n ${num("*")} k ${num("*")} math${num(".")}log2(n ${num("+")} ${num("1")}), ${num("1")})\n`,
        `${red("TypeError")}: can't multiply sequence by non-int of type 'float'`,
      ],
    },
  ]),
  code(
    6,
    `import warnings
from tqdm import trange

for _ in trange(8, desc="weaving"):
    pass
warnings.warn("the loom is warm; consider fewer weavers")`,
    [
      stream("stderr", `${progress}\n`),
      stream(
        "stderr",
        '/tmp/ipykernel_2024/loom.py:6: UserWarning: the loom is warm; consider fewer weavers\n  warnings.warn("the loom is warm; consider fewer weavers")\n',
      ),
    ],
  ),
  md(`## 群织

多个光标同时编织同一个笔记本：一个在写代码，一个在运行，另一个在整理输出。

\`\`\`python
layers(16)  # try it
\`\`\``),
  code(null, "# Your turn: run layers(16) and compare"),
];

const notebook = {
  cells,
  metadata: {
    kernelspec: { display_name: "Python 3 (ipykernel)", language: "python", name: "python3" },
    language_info: { name: "python", version: "3.12.4" },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])]),
        )
      : v;

writeFileSync(join(here, "loom-tour.ipynb"), `${JSON.stringify(sortKeys(notebook), null, 1)}\n`);
console.log("loom-tour.ipynb written");
