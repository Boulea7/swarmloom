# OFD sample

`loom-receipt.ofd` is a small OFD (GB/T 33190) package written for this repository (about 5 KB). It is the fixture of the `@swarmloom/adapter-ofd` tests and the OFD demo. It has:

- `OFD.xml`, `Doc_0/Document.xml`, two pages and a template page with a header rule;
- a public font resource (SimSun, KaiTi, SimHei, Courier New) that exercises the font fallback table;
- `TextObject` runs with `DeltaX` (including the `g N v` repeat form) and a vertical `DeltaY` run;
- `PathObject` outlines in `AbbreviatedData` with lines, a cubic curve, arcs and fills;
- an `ImageObject` from a document `MultiMedia` resource.

`generate.mjs` writes it from scratch and packs it with `../odf/pack.mjs`, so the output is byte-for-byte reproducible:

```sh
node examples/ofd/generate.mjs [--out dir]
```

The script fails if the file reaches 200 KB. The text, numbers and artwork are original, and the receipt is fictional. License: MIT.
