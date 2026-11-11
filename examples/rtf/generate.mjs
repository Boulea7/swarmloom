#!/usr/bin/env node
// Writes loom-letter.rtf. The RTF below is hand-written: GBK (\ansicpg936) and Big5 (\fcharset136)
// bytes as \'hh escapes, \u escapes with \uc skips, a font and colour table, a shaded table, a
// header and an unknown {\*...} destination (both must be skipped) and a page break. The only
// generated part is the PNG of the \pict, our own woven-thread artwork from ../odf/pack.mjs, written
// as hex.
//
// Usage: node examples/rtf/generate.mjs [--out dir]

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { weave } from "../odf/pack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string", default: here } } });
const MAX_BYTES = 200 * 1024;

const png = weave(64, 64);
const hex = png.toString("hex").replace(/(.{128})/g, "$1\n");

const cell = (bg) =>
  `\\clcbpat${bg}\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10`;
const row = (bg) => `\\trowd\\trgaph108\\trleft0${cell(bg)}\\cellx3000${cell(bg)}\\cellx6000${cell(bg)}\\cellx9026\n`;

const rtf = String.raw`{\rtf1\ansi\ansicpg936\deff0\deftab720\uc1
{\fonttbl{\f0\fswiss\fcharset0 Calibri;}{\f1\fnil\fcharset134 \'cb\'ce\'cc\'e5{\*\falt SimSun};}{\f2\froman\fcharset136 \'b2\'d3\'a9\'fa\'c5\'e9;}
{\f3\fmodern\fcharset0 Courier New;}{\f4\ftech\fcharset2 Symbol;}{\f5\fnil\fcharset134 \'ba\'da\'cc\'e5;}}
{\colortbl;\red67\green56\blue202;\red180\green83\blue9;\red238\green242\blue255;\red255\green107\blue91;\red255\green247\blue237;}
{\*\generator SwarmLoom hand-written sample;}
{\info{\title Loom letter}{\author SwarmLoom samples}}
\paperw11906\paperh16838\margl1440\margr1440\margt1440\margb1440
{\header \pard\qr\f0\fs16 This header is skipped\par}
\pard\plain\sa120\qc\f0\fs40\b\cf1 Loom letter\par
\pard\plain\sa240\qc\f0\fs22\i\cf2 A hand-written RTF sample for SwarmLoom\par
\pard\plain\sa120\qj\f0\fs22 Rich Text Format keeps text in \b bold\b0 , \i italic\i0 , \ul underline\ulnone , \strike struck\strike0  and {\cf4 colour}. Sizes run from {\fs16 small} to {\fs32 large}; {\super super}script and {\sub sub}script sit off the baseline, {\highlight5 highlighted} text has a background. Quotes are \ldblquote curly\rdblquote  and dashes \endash  short \emdash  long.\par
\pard\plain\sa120\f1\fs22 GBK: \'c8\'ba\'d6\'af\'c8\'c3\'d2\'bb\'c8\'ba\'b9\'e2\'b1\'ea\'b0\'d1\'ce\'c4\'b5\'b5\'d6\'af\'b3\'c9\'bb\'ad\'c3\'e6\'a1\'a3\par
\pard\plain\sa120\f1\fs22 Unicode: \u32455?\u26426?\u31508?\u35760? {\uc2\u32676\'c8\'ba}\u32455?\par
\pard\plain\sa120\f2\fs22 Big5: \'c1\'63\'c5\'e9\'a4\'a4\'a4\'e5\'a1\'47\'b8\'67\'bd\'75\'bb\'50\'bd\'6e\'bd\'75\'a1\'43\par
{\pard\plain\li360\fi-360\sa60\f0\fs22{\listtext\pard\plain\f4\fs22 \'b7\tab}Warp: threads stretched along the loom.\par}
{\pard\plain\li360\fi-360\sa60\f0\fs22{\listtext\pard\plain\f4\fs22 \'b7\tab}Weft: threads carried across it.\par}
{\pard\plain\li360\fi-360\sa240\f0\fs22{\listtext\pard\plain\f4\fs22 \'b7\tab}Sett: how the two are balanced.\par}
\pard\plain\sa120\f0\fs22 A table with shaded heads:\par
${row(3)}\pard\intbl\plain\f5\fs22\b \'cf\'ee\'c4\'bf\cell\pard\intbl\qr\plain\f5\fs22\b \'be\'ad\'cf\'df\cell\pard\intbl\qr\plain\f5\fs22\b \'ce\'b3\'cf\'df\cell\row
${row(0)}\pard\intbl\plain\f0\fs22 Plain\cell\pard\intbl\qr\plain\f0\fs22 1\cell\pard\intbl\qr\plain\f0\fs22 1\cell\row
${row(0)}\pard\intbl\plain\f0\fs22 Twill 2/2\cell\pard\intbl\qr\plain\f0\fs22 2\cell\pard\intbl\qr\plain\f0\fs22 2\cell\row
${row(0)}\pard\intbl\plain\f0\fs22 Satin 5\cell\pard\intbl\qr\plain\f0\fs22 4\cell\pard\intbl\qr\plain\f0\fs22 1\cell\row
\pard\plain\sb240\sa120\f0\fs22 A picture from \\pict\\pngblip:\par
\pard\plain\qc\sa120{\*\shppict{\pict\pngblip\picw64\pich64\picwgoal1440\pichgoal1440{\*\blipuid 0123456789abcdef}
${hex}}}{\nonshppict{\pict\wmetafile8\picw1693\pich1693 0100090000}}\par
\pard\plain\sa120\f0\fs22 Unknown destinations are ignored: {\*\swarmloomsecret this text must not appear}done. {\field{\*\fldinst HYPERLINK "https://example.invalid"}{\fldrslt {\ul\cf1 A field result}}} stays.\par
\pard\plain\f3\fs20 monospace\tab tabbed\line second line\par
\page
\pard\plain\qc\sa120\f0\fs28\b Page two\par
\pard\plain\f0\fs22 After an explicit page break.\par
}
`;

const bytes = Buffer.from(rtf, "latin1");
if (bytes.length >= MAX_BYTES)
  throw new Error(`loom-letter.rtf is ${bytes.length} bytes; samples must stay under ${MAX_BYTES}`);
writeFileSync(join(values.out, "loom-letter.rtf"), bytes);
console.log(`loom-letter.rtf: ${bytes.length} bytes`);
