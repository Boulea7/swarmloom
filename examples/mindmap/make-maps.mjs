#!/usr/bin/env node
// Writes two original sample mind maps:
//   loom.xmind      XMind (Zen / 2020+) archive: content.json, metadata.json, manifest.json
//   release-plan.mm FreeMind / Freeplane document with side hints, a folded node, rich text and notes
// The zip writer below stores entries uncompressed, so the output is byte-for-byte reproducible.
//
//   node examples/mindmap/make-maps.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* ---------------- minimal zip (stored) ---------------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  // Fixed DOS date/time (2024-06-11 12:00) for reproducible archives.
  const time = (12 << 11) | (0 << 5);
  const date = ((2024 - 1980) << 9) | (6 << 5) | 11;
  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ---------------- XMind (Zen) ---------------- */

let counter = 0;
const topic = (title, children = [], extra = {}) => ({
  id: `t${(++counter).toString(36).padStart(3, "0")}`,
  title,
  ...extra,
  ...(children.length ? { children: { attached: children } } : {}),
});

const root = topic(
  "SwarmLoom",
  [
    topic("Inputs", [
      topic("Documents", [topic("Markdown"), topic("DOCX and PDF"), topic("Slides and sheets")]),
      topic("Code and patches", [topic("Source files"), topic("Unified diffs")]),
      topic("Notebooks"),
      topic("Terminal recordings"),
    ]),
    topic("Choreography", [
      topic("Type text", [], { notes: { plain: { content: "24-42 ms per grapheme, with key sounds." } } }),
      topic("Draw paths with the pen"),
      topic("Clone repeated items"),
      topic("Amend copy"),
    ]),
    topic("Sound", [topic("Keys and clicks"), topic("Notes on a scale"), topic("Soft limiter")]),
    topic("Exports", [topic("Video"), topic("GIF"), topic("Embeds", [], { href: "https://example.org/embed" })]),
    topic("群织 · many hands", [topic("游标分工"), topic("同一画布")]),
  ],
  { structureClass: "org.xmind.ui.map.unbalanced" },
);

const content = [{ id: "sheet-1", class: "sheet", title: "Loom overview", rootTopic: root }];
const metadata = { creator: { name: "SwarmLoom example generator", version: "1" } };
const manifest = { "file-entries": { "content.json": {}, "metadata.json": {} } };
writeFileSync(
  join(here, "loom.xmind"),
  zip([
    ["content.json", JSON.stringify(content)],
    ["metadata.json", JSON.stringify(metadata)],
    ["manifest.json", JSON.stringify(manifest)],
  ]),
);

/* ---------------- FreeMind / Freeplane ---------------- */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
let mmId = 0;
const node = (text, children = [], attrs = {}, inner = "") => {
  const a = Object.entries({ TEXT: text, ID: `ID_${(++mmId).toString().padStart(4, "0")}`, ...attrs })
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
  return `<node${a}>${inner}${children.join("")}</node>`;
};
const note = (text) =>
  `<richcontent TYPE="NOTE"><html><head></head><body><p>${esc(text)}</p></body></html></richcontent>`;

const mm = `<map version="freeplane 1.9.13">
<!-- Generated by examples/mindmap/make-maps.mjs -->
${node("Release 0.2", [
  node("Adapters", [node("Notebook"), node("Terminal"), node("Diff"), node("Mind map")], { POSITION: "right" }),
  node(
    "Quality",
    [node("Unit tables"), node("Browser tests"), node("Lint and types")],
    { POSITION: "right" },
    note("Every adapter loads its example in a real browser."),
  ),
  node("Docs", [node("README per package"), node("Format guide")], { POSITION: "left" }),
  node("Later", [node("Word-level diff highlights"), node("Notebook widgets")], { POSITION: "left", FOLDED: "true" }),
  `<node ID="ID_rich" POSITION="left"><richcontent TYPE="NODE"><html><head></head><body><p>Ship it</p><p>on a Friday?</p></body></html></richcontent></node>`,
])}
</map>
`;
writeFileSync(join(here, "release-plan.mm"), mm);
console.log("loom.xmind and release-plan.mm written");
