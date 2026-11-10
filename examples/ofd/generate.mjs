#!/usr/bin/env node
// Generates loom-receipt.ofd, a minimal but complete OFD package (GB/T 33190) built by hand:
// OFD.xml -> Doc_0/Document.xml -> two pages and a template page, a public font resource
// (SimSun, KaiTi, SimHei, Courier New) and a document image resource. Pages use TextObject
// (TextCode with DeltaX, the "g N v" repeat form and a vertical DeltaY run), PathObject
// (AbbreviatedData with lines, a cubic curve, arcs and fills) and ImageObject. The picture is our
// own woven-thread artwork from ../odf/pack.mjs.
//
// Usage: node examples/ofd/generate.mjs [--out dir]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { weave, zip } from "../odf/pack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string", default: here } } });
const MAX_BYTES = 200 * 1024;

const NS = 'xmlns:ofd="http://www.ofdspec.org/2016"';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const FONT = { song: 5, kai: 6, hei: 7, mono: 8 };

let nextId = 20;
const id = () => nextId++;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A text object: `advance` is the per-glyph DeltaX in mm (written with the "g N v" form). */
function text(x, y, w, h, font, size, str, { color = "0 0 0", advance, weight, vertical } = {}) {
  const glyphs = [...str].length;
  let deltas = "";
  if (vertical) deltas = ` DeltaY="g ${glyphs - 1} ${size}"`;
  else if (advance && glyphs > 1) deltas = ` DeltaX="g ${glyphs - 1} ${advance}"`;
  const w8 = weight ? ` Weight="${weight}"` : "";
  return `<ofd:TextObject ID="${id()}" Boundary="${x} ${y} ${w} ${h}" Font="${font}" Size="${size}"${w8}>
        <ofd:FillColor Value="${color}"/>
        <ofd:TextCode X="0" Y="${size}"${deltas}>${esc(str)}</ofd:TextCode>
      </ofd:TextObject>`;
}

/** A path object; `data` is AbbreviatedData in the object's own millimetre space. */
function path(x, y, w, h, data, { stroke = "0 0 0", fill, width = 0.353, dash } = {}) {
  const fillAttr = fill ? ' Fill="true"' : "";
  const strokeAttr = stroke ? "" : ' Stroke="false"';
  const dashAttr = dash ? ` DashPattern="${dash}"` : "";
  return `<ofd:PathObject ID="${id()}" Boundary="${x} ${y} ${w} ${h}" LineWidth="${width}"${fillAttr}${strokeAttr}${dashAttr}>
        ${stroke ? `<ofd:StrokeColor Value="${stroke}"/>` : ""}${fill ? `<ofd:FillColor Value="${fill}"/>` : ""}
        <ofd:AbbreviatedData>${data}</ofd:AbbreviatedData>
      </ofd:PathObject>`;
}

function page(objects, { template = true } = {}) {
  return `${HEAD}<ofd:Page ${NS}>
  <ofd:Area><ofd:PhysicalBox>0 0 210 148</ofd:PhysicalBox></ofd:Area>
  ${template ? '<ofd:Template TemplateID="2" ZOrder="Background"/>' : ""}
  <ofd:Content>
    <ofd:Layer ID="${id()}" Type="Body">
      ${objects.join("\n      ")}
    </ofd:Layer>
  </ofd:Content>
</ofd:Page>
`;
}

const ofd = `${HEAD}<ofd:OFD ${NS} Version="1.1" DocType="OFD">
  <ofd:DocBody>
    <ofd:DocInfo>
      <ofd:DocID>5f1d3a526f0e4d7b9b9e2a7c1c0e5a02</ofd:DocID>
      <ofd:Title>织机工坊收据</ofd:Title>
      <ofd:Author>SwarmLoom samples</ofd:Author>
      <ofd:CreationDate>2026-01-01</ofd:CreationDate>
    </ofd:DocInfo>
    <ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot>
  </ofd:DocBody>
</ofd:OFD>
`;

const documentXml = `${HEAD}<ofd:Document ${NS}>
  <ofd:CommonData>
    <ofd:MaxUnitID>200</ofd:MaxUnitID>
    <ofd:PageArea><ofd:PhysicalBox>0 0 210 148</ofd:PhysicalBox></ofd:PageArea>
    <ofd:PublicRes>PublicRes.xml</ofd:PublicRes>
    <ofd:DocumentRes>DocumentRes.xml</ofd:DocumentRes>
    <ofd:TemplatePage ID="2" BaseLoc="Tpls/Tpl_0/Content.xml"/>
  </ofd:CommonData>
  <ofd:Pages>
    <ofd:Page ID="3" BaseLoc="Pages/Page_0/Content.xml"/>
    <ofd:Page ID="4" BaseLoc="Pages/Page_1/Content.xml"/>
  </ofd:Pages>
</ofd:Document>
`;

const publicRes = `${HEAD}<ofd:Res ${NS} BaseLoc="Res">
  <ofd:Fonts>
    <ofd:Font ID="${FONT.song}" FontName="宋体" FamilyName="SimSun"/>
    <ofd:Font ID="${FONT.kai}" FontName="楷体" FamilyName="KaiTi"/>
    <ofd:Font ID="${FONT.hei}" FontName="黑体" FamilyName="SimHei"/>
    <ofd:Font ID="${FONT.mono}" FontName="Courier New" FamilyName="Courier New"/>
  </ofd:Fonts>
</ofd:Res>
`;

const documentRes = `${HEAD}<ofd:Res ${NS} BaseLoc="Res">
  <ofd:MultiMedias>
    <ofd:MultiMedia ID="9" Type="Image" Format="PNG"><ofd:MediaFile>loom.png</ofd:MediaFile></ofd:MultiMedia>
  </ofd:MultiMedias>
</ofd:Res>
`;

const template = page(
  [
    path(0, 0, 210, 14, "M 0 0 L 210 0 L 210 14 L 0 14 C", { stroke: null, fill: "67 56 202" }),
    text(12, 3.5, 90, 7, FONT.hei, 5, "SwarmLoom 织机工坊", { color: "255 255 255" }),
    path(12, 136, 186, 1, "M 0 0.5 L 186 0.5", { stroke: "160 160 176", width: 0.25 }),
    text(12, 138.5, 120, 5, FONT.song, 3, "本样例为群织自制，仅用于测试。", { color: "110 110 128", advance: 3 }),
  ],
  { template: false },
);

const rows = [
  ["经线（棉）", "12", " 36.00"],
  ["纬线（麻）", "8", " 28.80"],
  ["平纹织造", "1", "120.00"],
];
const table = [];
const top = 44;
const rowH = 9;
for (let r = 0; r <= rows.length + 1; r++)
  table.push(
    path(12, top + r * rowH, 120, 0.5, `M 0 0 L 120 0`, { width: r === 0 || r === rows.length + 1 ? 0.5 : 0.25 }),
  );
for (const x of [0, 64, 88, 120])
  table.push(
    path(12 + x, top, 0.5, rowH * (rows.length + 1), `M 0 0 L 0 ${rowH * (rows.length + 1)}`, { width: 0.25 }),
  );
const cells = [];
const head = ["项目", "数量", "金额"];
head.forEach((h, i) => {
  cells.push(text(14 + [0, 64, 88][i], top + 2, 30, 6, FONT.hei, 4, h, { advance: 4 }));
});
rows.forEach((row, r) => {
  const y = top + (r + 1) * rowH + 2.2;
  cells.push(text(14, y, 60, 6, FONT.song, 4, row[0], { advance: 4 }));
  cells.push(text(78, y, 20, 6, FONT.mono, 4, row[1], { advance: 2.4 }));
  cells.push(text(102, y, 30, 6, FONT.mono, 4, row[2], { advance: 2.4 }));
});

const page0 = page([
  text(12, 20, 80, 12, FONT.kai, 9, "收据", { advance: 9, weight: 700 }),
  text(40, 24, 80, 8, FONT.mono, 4.2, "Receipt No. 2026-0001", { advance: 2.52 }),
  `<ofd:ImageObject ID="${id()}" Boundary="160 20 36 36" ResourceID="9" CTM="36 0 0 36 0 0"/>`,
  ...table,
  ...cells,
  text(14, top + (rows.length + 1) * rowH + 4, 80, 6, FONT.hei, 4, "合计：184.80 元", { advance: 4 }),
  // A stamp: two arcs closing a circle, filled lightly, with red KaiTi text.
  path(146, 70, 40, 40, "M 2 20 A 18 18 0 1 1 38 20 A 18 18 0 1 1 2 20 C", {
    stroke: "220 38 38",
    fill: "254 242 242",
    width: 0.8,
  }),
  text(153, 85, 30, 10, FONT.kai, 8, "已付款", { color: "220 38 38", advance: 8.5 }),
  // A signature stroke: one cubic curve and a quadratic tail.
  path(20, 108, 60, 16, "S 0 12 B 10 -4 20 20 32 8 Q 44 -2 58 10", { stroke: "30 41 59", width: 0.6 }),
  text(20, 125, 60, 6, FONT.song, 3.5, "签收人", { advance: 3.5, color: "71 85 105" }),
]);

const page1 = page([
  text(12, 20, 120, 8, FONT.hei, 6, "附注 Notes", { advance: 4.8 }),
  text(12, 32, 150, 6, FONT.song, 4, "经线与纬线交织成布，文字按 DeltaX 逐字定位。"),
  text(12, 40, 150, 6, FONT.mono, 3.5, "Each glyph advance comes from DeltaX.", { advance: 2.1 }),
  text(180, 30, 8, 60, FONT.kai, 6, "竖排文字", { vertical: true }),
  path(12, 52, 150, 30, "M 0 28 L 30 6 L 60 20 L 90 2 L 120 16 L 150 8", { stroke: "255 107 91", width: 0.8 }),
  path(12, 52, 150, 30, "M 0 30 L 150 30", { stroke: "148 163 184", width: 0.3, dash: "1 1" }),
]);

const entries = [
  { name: "OFD.xml", data: ofd },
  { name: "Doc_0/Document.xml", data: documentXml },
  { name: "Doc_0/PublicRes.xml", data: publicRes },
  { name: "Doc_0/DocumentRes.xml", data: documentRes },
  { name: "Doc_0/Res/loom.png", data: weave(72, 72), store: true },
  { name: "Doc_0/Tpls/Tpl_0/Content.xml", data: template },
  { name: "Doc_0/Pages/Page_0/Content.xml", data: page0 },
  { name: "Doc_0/Pages/Page_1/Content.xml", data: page1 },
];

const bytes = zip(entries);
if (bytes.length >= MAX_BYTES)
  throw new Error(`loom-receipt.ofd is ${bytes.length} bytes; samples must stay under ${MAX_BYTES}`);
writeFileSync(join(values.out, "loom-receipt.ofd"), bytes);
console.log(`loom-receipt.ofd: ${bytes.length} bytes`);
