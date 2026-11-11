# RTF sample

`loom-letter.rtf` is a two-page letter written for this repository (about 6 KB). It is the fixture of the `@swarmloom/adapter-rtf` tests and the RTF demo. The RTF is hand-written to cover:

- GBK (`\ansicpg936`) and Big5 (`\fcharset136`) text as `\'hh` bytes, and `\u` escapes with `\uc` skips;
- a font table and a colour table, with bold, italic, underline, sizes and colours;
- a table with shaded cells;
- a PNG picture (`\pict`);
- a header and an unknown `{\*...}` destination, both of which must be skipped;
- a page break.

`generate.mjs` writes the file. The only generated part is the picture, the woven-thread PNG from `../odf/pack.mjs`, written as hex:

```sh
node examples/rtf/generate.mjs [--out dir]
```

The output is byte-for-byte reproducible, and the script fails if the file reaches 200 KB. The text and artwork are original. License: MIT.
