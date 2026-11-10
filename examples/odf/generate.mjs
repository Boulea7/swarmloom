#!/usr/bin/env node
// Generates the OpenDocument samples of this folder from scratch: report.odt (text), budget.ods
// (spreadsheet) and deck.odp (presentation). No office suite is needed: the XML is written here
// and packed with pack.mjs (mimetype first and stored, as ODF 1.3 part 2 requires).
//
// Usage: node examples/odf/generate.mjs [--out dir]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { weave, zip } from "./pack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string", default: here } } });
const MAX_BYTES = 200 * 1024;

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"',
].join(" ");

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

const FONTS = `<office:font-face-decls>
  <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman"/>
  <style:font-face style:name="Calibri" svg:font-family="Calibri" style:font-family-generic="swiss"/>
  <style:font-face style:name="SimSun" svg:font-family="SimSun" style:font-family-generic="system"/>
</office:font-face-decls>`;

function manifest(mime, parts) {
  const entries = parts
    .map(([path, type]) => `  <manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`)
    .join("\n");
  return `${HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/>
${entries}
</manifest:manifest>\n`;
}

function meta(title) {
  return `${HEAD}<office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${title}</dc:title><meta:generator>SwarmLoom examples/odf/generate.mjs</meta:generator></office:meta></office:document-meta>\n`;
}

function pack(file, mime, title, content, styles, pictures = []) {
  const parts = [
    ["content.xml", "text/xml"],
    ["styles.xml", "text/xml"],
    ["meta.xml", "text/xml"],
    ...pictures.map(([name]) => [name, "image/png"]),
  ];
  const bytes = zip([
    { name: "mimetype", data: mime, store: true },
    { name: "content.xml", data: content },
    { name: "styles.xml", data: styles },
    { name: "meta.xml", data: meta(title) },
    ...pictures.map(([name, data]) => ({ name, data, store: true })),
    { name: "META-INF/manifest.xml", data: manifest(mime, parts) },
  ]);
  if (bytes.length >= MAX_BYTES)
    throw new Error(`${file} is ${bytes.length} bytes; samples must stay under ${MAX_BYTES}`);
  writeFileSync(join(values.out, file), bytes);
  console.log(`${file}: ${bytes.length} bytes`);
}

/* ---------------------------------------------------------------- ODT */

const odtStyles = `${HEAD}<office:document-styles ${NS} office:version="1.3">
${FONTS}
<office:styles>
  <style:default-style style:family="paragraph">
    <style:paragraph-properties fo:line-height="125%"/>
    <style:text-properties style:font-name="Liberation Serif" fo:font-size="11pt" style:font-name-asian="SimSun" fo:color="#1F1F2E"/>
  </style:default-style>
  <style:style style:name="Standard" style:family="paragraph"/>
  <style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard">
    <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.22cm" fo:text-align="justify"/>
  </style:style>
  <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard">
    <style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm"/>
    <style:text-properties style:font-name="Calibri" fo:font-weight="bold" fo:color="#2A2A6E"/>
  </style:style>
  <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading">
    <style:text-properties fo:font-size="20pt"/>
  </style:style>
  <style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading">
    <style:text-properties fo:font-size="14pt" fo:color="#5B5BF7"/>
  </style:style>
  <style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties fo:font-size="9pt"/>
  </style:style>
  <style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard">
    <style:paragraph-properties fo:text-align="end"/>
    <style:text-properties fo:font-size="8pt" fo:color="#6B6B7B"/>
  </style:style>
  <style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard">
    <style:paragraph-properties fo:text-align="center"/>
    <style:text-properties fo:font-size="8pt" fo:color="#6B6B7B"/>
  </style:style>
</office:styles>
<office:automatic-styles>
  <style:page-layout style:name="pm1">
    <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.2cm" fo:margin-right="2.2cm"/>
  </style:page-layout>
</office:automatic-styles>
<office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="pm1">
    <style:header><text:p text:style-name="Header">SwarmLoom sample · OpenDocument text</text:p></style:header>
    <style:footer><text:p text:style-name="Footer">Page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>2</text:page-count></text:p></style:footer>
  </style:master-page>
</office:master-styles>
</office:document-styles>
`;

const odtContent = `${HEAD}<office:document-content ${NS} office:version="1.3">
${FONTS}
<office:automatic-styles>
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Text_20_body">
    <style:paragraph-properties fo:text-align="start" fo:padding="0.2cm" fo:background-color="#F3F3FB" fo:border-left="2pt solid #5B5BF7"/>
  </style:style>
  <style:style style:name="P2" style:family="paragraph" style:parent-style-name="Heading_20_1">
    <style:paragraph-properties fo:break-before="page"/>
  </style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
  <style:style style:name="T3" style:family="text"><style:text-properties fo:color="#FF6B5B" style:text-underline-style="solid"/></style:style>
  <style:style style:name="T4" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
  <style:style style:name="Tbl" style:family="table"><style:table-properties style:width="16.6cm" table:align="left" fo:margin-bottom="0.3cm"/></style:style>
  <style:style style:name="Tbl.A" style:family="table-column"><style:table-column-properties style:column-width="6.6cm"/></style:style>
  <style:style style:name="Tbl.B" style:family="table-column"><style:table-column-properties style:column-width="5cm"/></style:style>
  <style:style style:name="Tbl.H" style:family="table-cell"><style:table-cell-properties fo:background-color="#E6E6FF" fo:border="0.5pt solid #8F8FA8" fo:padding="0.1cm"/></style:style>
  <style:style style:name="Tbl.C" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #8F8FA8" fo:padding="0.1cm"/></style:style>
  <style:style style:name="Tbl.HP" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="Tbl.NP" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/></style:style>
  <style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:horizontal-pos="center" style:horizontal-rel="paragraph"/></style:style>
  <text:list-style style:name="L1">
    <text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="0.635cm"/></style:list-level-properties></text:list-level-style-bullet>
    <text:list-level-style-bullet text:level="2" text:bullet-char="◦"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-bullet>
  </text:list-style>
  <text:list-style style:name="L2">
    <text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment fo:text-indent="-0.635cm" fo:margin-left="0.635cm"/></style:list-level-properties></text:list-level-style-number>
  </text:list-style>
</office:automatic-styles>
<office:body>
<office:text>
  <text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/></text:sequence-decls>
  <text:h text:style-name="Heading_20_1" text:outline-level="1">Field notes from the loom</text:h>
  <text:p text:style-name="Text_20_body">A swarm of cursors rebuilds this page while you watch. Each weaver takes the next free block, drags out its frame and types its text, so a <text:span text:style-name="T1">heading</text:span> appears before the paragraphs it introduces and <text:span text:style-name="T2">every table cell</text:span> is filled row by row.<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p text:style-name="Footnote">The weavers are a visual replay of finished content, not autonomous agents.</text:p></text:note-body></text:note></text:p>
  <text:p text:style-name="Text_20_body">群织让一群光标当着你的面，把文档一笔一画织出来。标题先出现，正文随后，表格逐行填满。</text:p>
  <text:p text:style-name="P1">Tip: the sample uses Calibri for headings and SimSun for Chinese text. Machines without them show <text:span text:style-name="T3">open substitutes</text:span>, and the adapter says so.</text:p>
  <text:h text:style-name="Heading_20_2" text:outline-level="2">What the weavers do</text:h>
  <text:list text:style-name="L1">
    <text:list-item><text:p text:style-name="Text_20_body">Lay out the page sheet and its margins.</text:p></text:list-item>
    <text:list-item><text:p text:style-name="Text_20_body">Type headings, paragraphs and list items.</text:p>
      <text:list><text:list-item><text:p text:style-name="Text_20_body">Nested items are indented under their parent.</text:p></text:list-item></text:list>
    </text:list-item>
    <text:list-item><text:p text:style-name="Text_20_body">Sweep in pictures, then fill the tables.</text:p></text:list-item>
  </text:list>
  <text:h text:style-name="Heading_20_2" text:outline-level="2">Thread counts</text:h>
  <table:table table:name="Threads" table:style-name="Tbl">
    <table:table-column table:style-name="Tbl.A"/>
    <table:table-column table:style-name="Tbl.B" table:number-columns-repeated="2"/>
    <table:table-header-rows>
      <table:table-row>
        <table:table-cell table:style-name="Tbl.H" office:value-type="string"><text:p text:style-name="Tbl.HP">Fabric</text:p></table:table-cell>
        <table:table-cell table:style-name="Tbl.H" office:value-type="string"><text:p text:style-name="Tbl.HP">Warp</text:p></table:table-cell>
        <table:table-cell table:style-name="Tbl.H" office:value-type="string"><text:p text:style-name="Tbl.HP">Weft</text:p></table:table-cell>
      </table:table-row>
    </table:table-header-rows>
    <table:table-row>
      <table:table-cell table:style-name="Tbl.C" office:value-type="string"><text:p>Plain weave</text:p></table:table-cell>
      <table:table-cell table:style-name="Tbl.C" office:value-type="float" office:value="48"><text:p text:style-name="Tbl.NP">48</text:p></table:table-cell>
      <table:table-cell table:style-name="Tbl.C" office:value-type="float" office:value="44"><text:p text:style-name="Tbl.NP">44</text:p></table:table-cell>
    </table:table-row>
    <table:table-row>
      <table:table-cell table:style-name="Tbl.C" office:value-type="string"><text:p>Twill</text:p></table:table-cell>
      <table:table-cell table:style-name="Tbl.C" office:value-type="float" office:value="64"><text:p text:style-name="Tbl.NP">64</text:p></table:table-cell>
      <table:table-cell table:style-name="Tbl.C" office:value-type="float" office:value="60"><text:p text:style-name="Tbl.NP">60</text:p></table:table-cell>
    </table:table-row>
    <table:table-row>
      <table:table-cell table:style-name="Tbl.C" table:number-columns-spanned="3" office:value-type="string"><text:p>Counts are threads per centimetre in our own swatches.</text:p></table:table-cell>
      <table:covered-table-cell/><table:covered-table-cell/>
    </table:table-row>
  </table:table>
  <text:p text:style-name="Text_20_body"><draw:frame draw:style-name="fr1" draw:name="Swatch" text:anchor-type="paragraph" svg:width="9cm" svg:height="4.5cm" draw:z-index="0"><draw:image xlink:href="Pictures/swatch.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>A woven swatch</svg:title></draw:frame></text:p>
  <text:h text:style-name="P2" text:outline-level="1">Second sheet</text:h>
  <text:p text:style-name="Text_20_body">Page breaks in OpenDocument files are kept: explicit breaks and the soft breaks an office suite saved start a new sheet here.</text:p>
  <text:list text:style-name="L2">
    <text:list-item><text:p text:style-name="Text_20_body">Unzip the package and read its styles.</text:p></text:list-item>
    <text:list-item><text:p text:style-name="Text_20_body">Turn paragraphs, lists and tables into HTML.</text:p></text:list-item>
    <text:list-item><text:p text:style-name="Text_20_body">Snapshot the sheets and let the swarm weave them.</text:p></text:list-item>
  </text:list>
  <text:p text:style-name="Text_20_body">E = mc<text:span text:style-name="T4">2</text:span> is set with a superscript run.</text:p>
</office:text>
</office:body>
</office:document-content>
`;

pack("report.odt", "application/vnd.oasis.opendocument.text", "Field notes from the loom", odtContent, odtStyles, [
  ["Pictures/swatch.png", weave(340, 170)],
]);

/* ---------------------------------------------------------------- ODS */

const odsStyles = `${HEAD}<office:document-styles ${NS} office:version="1.3">
${FONTS}
<office:styles>
  <style:default-style style:family="table-cell">
    <style:text-properties style:font-name="Calibri" fo:font-size="10pt"/>
  </style:default-style>
  <style:style style:name="Default" style:family="table-cell"/>
</office:styles>
</office:document-styles>
`;

const rows = [
  ["Warp threads", 1200, 1350, 0.125],
  ["Weft threads", 980, 1105, 0.128],
  ["Dye batches", 42, 39, -0.071],
  ["Looms in use", 6, 8, 0.333],
  ["织工（光标）", 24, 32, 0.333],
];

function num(value, styleName = "ce4") {
  return `<table:table-cell table:style-name="${styleName}" office:value-type="float" office:value="${value}"><text:p>${value.toLocaleString("en-US")}</text:p></table:table-cell>`;
}

function pct(value) {
  return `<table:table-cell table:style-name="ce5" office:value-type="percentage" office:value="${value}"><text:p>${(value * 100).toFixed(1)}%</text:p></table:table-cell>`;
}

const str = (text, styleName = "ce3") =>
  `<table:table-cell table:style-name="${styleName}" office:value-type="string"><text:p>${text}</text:p></table:table-cell>`;

const totalQ1 = rows.reduce((s, r) => s + r[1], 0);
const totalQ2 = rows.reduce((s, r) => s + r[2], 0);

const odsContent = `${HEAD}<office:document-content ${NS} office:version="1.3">
${FONTS}
<office:automatic-styles>
  <style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="4.2cm"/></style:style>
  <style:style style:name="co2" style:family="table-column"><style:table-column-properties style:column-width="2.6cm"/></style:style>
  <style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="0.9cm"/></style:style>
  <style:style style:name="ro2" style:family="table-row"><style:table-row-properties style:row-height="0.52cm"/></style:style>
  <style:style style:name="ce1" style:family="table-cell" style:parent-style-name="Default">
    <style:table-cell-properties style:vertical-align="middle"/>
    <style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#2A2A6E"/>
  </style:style>
  <style:style style:name="ce2" style:family="table-cell" style:parent-style-name="Default">
    <style:table-cell-properties fo:background-color="#5B5BF7" style:vertical-align="middle"/>
    <style:paragraph-properties fo:text-align="center"/>
    <style:text-properties fo:font-weight="bold" fo:color="#FFFFFF"/>
  </style:style>
  <style:style style:name="ce3" style:family="table-cell" style:parent-style-name="Default"/>
  <style:style style:name="ce4" style:family="table-cell" style:parent-style-name="Default"><style:paragraph-properties fo:text-align="end"/></style:style>
  <style:style style:name="ce5" style:family="table-cell" style:parent-style-name="Default"><style:text-properties fo:color="#0E7C70"/></style:style>
  <style:style style:name="ce6" style:family="table-cell" style:parent-style-name="Default">
    <style:table-cell-properties fo:background-color="#FFF1E0" fo:border-top="0.75pt solid #F5A524"/>
    <style:text-properties fo:font-weight="bold"/>
  </style:style>
</office:automatic-styles>
<office:body>
<office:spreadsheet>
  <table:table table:name="Loom budget">
    <table:table-column table:style-name="co1" table:default-cell-style-name="Default"/>
    <table:table-column table:style-name="co2" table:number-columns-repeated="3" table:default-cell-style-name="Default"/>
    <table:table-column table:style-name="co2" table:number-columns-repeated="1020" table:default-cell-style-name="Default"/>
    <table:table-row table:style-name="ro1">
      <table:table-cell table:style-name="ce1" table:number-columns-spanned="4" office:value-type="string"><text:p>Loom budget, first half</text:p></table:table-cell>
      <table:covered-table-cell table:number-columns-repeated="3"/>
      <table:table-cell table:number-columns-repeated="1020"/>
    </table:table-row>
    <table:table-row table:style-name="ro2">
      ${str("Item", "ce2")}${str("Q1", "ce2")}${str("Q2", "ce2")}${str("Change", "ce2")}
      <table:table-cell table:number-columns-repeated="1020"/>
    </table:table-row>
${rows.map((r) => `    <table:table-row table:style-name="ro2">${str(r[0])}${num(r[1])}${num(r[2])}${pct(r[3])}<table:table-cell table:number-columns-repeated="1020"/></table:table-row>`).join("\n")}
    <table:table-row table:style-name="ro2">
      ${str("Total", "ce6")}
      <table:table-cell table:style-name="ce6" table:formula="of:=SUM([.B3:.B7])" office:value-type="float" office:value="${totalQ1}"><text:p>${totalQ1.toLocaleString("en-US")}</text:p></table:table-cell>
      <table:table-cell table:style-name="ce6" table:formula="of:=SUM([.C3:.C7])" office:value-type="float" office:value="${totalQ2}"><text:p>${totalQ2.toLocaleString("en-US")}</text:p></table:table-cell>
      <table:table-cell table:style-name="ce6"/>
      <table:table-cell table:number-columns-repeated="1020"/>
    </table:table-row>
    <table:table-row table:style-name="ro2" table:number-rows-repeated="1048560"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
  </table:table>
  <table:table table:name="Notes">
    <table:table-column table:style-name="co1" table:number-columns-repeated="2"/>
    <table:table-row table:style-name="ro2">${str("Source", "ce2")}${str("Comment", "ce2")}</table:table-row>
    <table:table-row table:style-name="ro2">${str("Our own figures")}${str("Made up for this sample.")}</table:table-row>
  </table:table>
</office:spreadsheet>
</office:body>
</office:document-content>
`;

pack("budget.ods", "application/vnd.oasis.opendocument.spreadsheet", "Loom budget", odsContent, odsStyles);

/* ---------------------------------------------------------------- ODP */

const odpStyles = `${HEAD}<office:document-styles ${NS} office:version="1.3">
${FONTS}
<office:styles>
  <style:default-style style:family="graphic">
    <style:graphic-properties draw:fill="none" draw:stroke="none"/>
    <style:text-properties style:font-name="Calibri" fo:font-size="18pt" fo:color="#1F1F2E"/>
  </style:default-style>
</office:styles>
<office:automatic-styles>
  <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm"/></style:page-layout>
  <style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#FAFAFC"/></style:style>
  <style:style style:name="Mgr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#5B5BF7" draw:stroke="none"/></style:style>
</office:automatic-styles>
<office:master-styles>
  <style:master-page style:name="Loom" style:page-layout-name="PM1" draw:style-name="Mdp1">
    <draw:rect draw:style-name="Mgr1" svg:x="0cm" svg:y="15.15cm" svg:width="28cm" svg:height="0.6cm"/>
    <draw:frame presentation:class="title" presentation:placeholder="true" svg:x="1.4cm" svg:y="0.6cm" svg:width="25.2cm" svg:height="2.5cm"><draw:text-box/></draw:frame>
  </style:master-page>
</office:master-styles>
</office:document-styles>
`;

const odpContent = `${HEAD}<office:document-content ${NS} office:version="1.3">
${FONTS}
<office:automatic-styles>
  <style:style style:name="dp2" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#101028"/></style:style>
  <style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#5B5BF7" draw:stroke="none" draw:textarea-vertical-align="middle"/></style:style>
  <style:style style:name="gr2" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#FF6B5B" draw:stroke="solid" svg:stroke-color="#FFFFFF" svg:stroke-width="0.08cm"/></style:style>
  <style:style style:name="gr3" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="solid" svg:stroke-color="#14B8A6" svg:stroke-width="0.1cm"/></style:style>
  <style:style style:name="gr4" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#F5A524" draw:stroke="none"/></style:style>
  <style:style style:name="P1" style:family="paragraph"><style:text-properties fo:font-size="34pt" fo:font-weight="bold" fo:color="#2A2A6E"/></style:style>
  <style:style style:name="P2" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="20pt"/></style:style>
  <style:style style:name="P3" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#FFFFFF"/></style:style>
  <style:style style:name="P4" style:family="paragraph"><style:text-properties fo:font-size="40pt" fo:font-weight="bold" fo:color="#FFFFFF"/></style:style>
  <style:style style:name="P5" style:family="paragraph"><style:text-properties fo:font-size="18pt" fo:color="#C9C9F5" style:font-name-asian="SimSun"/></style:style>
  <text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="●"><style:list-level-properties text:space-before="0.3cm" text:min-label-width="0.9cm"/></text:list-level-style-bullet></text:list-style>
</office:automatic-styles>
<office:body>
<office:presentation>
  <draw:page draw:name="Weave" draw:master-page-name="Loom" draw:style-name="dp2">
    <draw:frame svg:x="1.6cm" svg:y="4.2cm" svg:width="16cm" svg:height="2.6cm"><draw:text-box><text:p text:style-name="P4">SwarmLoom</text:p></draw:text-box></draw:frame>
    <draw:frame svg:x="1.6cm" svg:y="7cm" svg:width="16cm" svg:height="2.2cm"><draw:text-box><text:p text:style-name="P5">Watch a swarm of cursors weave it into being.</text:p><text:p text:style-name="P5">让一群光标，把它织出来。</text:p></draw:text-box></draw:frame>
    <draw:custom-shape draw:style-name="gr2" svg:x="19.5cm" svg:y="3.4cm" svg:width="6cm" svg:height="6cm"><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse"/></draw:custom-shape>
    <draw:custom-shape draw:style-name="gr4" svg:x="21.2cm" svg:y="9.6cm" svg:width="3.6cm" svg:height="3cm"><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="isosceles-triangle"/></draw:custom-shape>
  </draw:page>
  <draw:page draw:name="How it works" draw:master-page-name="Loom">
    <draw:frame presentation:class="title" svg:x="1.4cm" svg:y="0.6cm" svg:width="25.2cm" svg:height="2.5cm"><draw:text-box><text:p text:style-name="P1">How the loom works</text:p></draw:text-box></draw:frame>
    <draw:frame presentation:class="outline" svg:x="1.4cm" svg:y="3.6cm" svg:width="13cm" svg:height="9cm"><draw:text-box>
      <text:list text:style-name="L1">
        <text:list-item><text:p text:style-name="P2">Read the slides and their masters</text:p></text:list-item>
        <text:list-item><text:p text:style-name="P2">Place frames, shapes and pictures</text:p></text:list-item>
        <text:list-item><text:p text:style-name="P2">Let the weavers build each slide</text:p></text:list-item>
      </text:list>
    </draw:text-box></draw:frame>
    <draw:frame svg:x="15.6cm" svg:y="3.6cm" svg:width="11cm" svg:height="5.5cm"><draw:image xlink:href="Pictures/weave.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>
    <draw:custom-shape draw:style-name="gr1" svg:x="15.6cm" svg:y="10cm" svg:width="5.2cm" svg:height="2.2cm"><text:p text:style-name="P3">Warp</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="round-rectangle"/></draw:custom-shape>
    <draw:line draw:style-name="gr3" svg:x1="20.9cm" svg:y1="11.1cm" svg:x2="21.5cm" svg:y2="11.1cm"/>
    <draw:custom-shape draw:style-name="gr1" svg:width="5.2cm" svg:height="2.2cm" draw:transform="rotate (0.05) translate (21.4cm 10.2cm)"><text:p text:style-name="P3">Weft</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="rectangle"/></draw:custom-shape>
  </draw:page>
</office:presentation>
</office:body>
</office:document-content>
`;

pack("deck.odp", "application/vnd.oasis.opendocument.presentation", "How the loom works", odpContent, odpStyles, [
  ["Pictures/weave.png", weave(320, 160, ["#101028", "#2A2A6E", "#14B8A6", "#F5A524"])],
]);
