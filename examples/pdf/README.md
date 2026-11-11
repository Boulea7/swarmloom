# PDF sample

`brochure.pdf` is a two-page A4 brochure written for this repository (about 94 KB). It is the fixture of
the `@swarmloom/adapter-pdf` browser tests and the PDF demo. It covers:

- a title, headings and paragraphs, including a line of CJK text;
- a table with rules;
- a raster figure drawn on a canvas;
- an illustrative vector bar chart (grid lines, a dashed trend curve and a rotated axis label) whose values are
  invented for the fixture and labelled as such, not benchmark results;
- two-column notes and a footer.

`generate.mjs` makes it again by printing its own HTML with Chromium:

```sh
SWARMLOOM_CHROME=$HOME/bin/chromium pnpm -F @swarmloom/adapter-pdf sample
# or: node examples/pdf/generate.mjs [--out path] [--chrome path]
```

The script fails when the output reaches 300 KB. Fonts come from the machine, so other machines may produce
slightly different bytes. The committed file is the reference.

The text, the invented chart values and the artwork are original. License: MIT.
