# EPUB sample

`loom-notes.epub` is a short EPUB 3 book written for this repository (about 15 KB). It is the fixture of the `@swarmloom/adapter-epub` tests and the EPUB demo. It has:

- a cover image and a navigation document, plus an EPUB 2 NCX for older readers;
- a book style sheet with a remote `@import`, `position: fixed` and an `@media print` block, which the adapter drops or scopes;
- three chapters: one with a figure, a list, a table, a link and a script that must never run; one in Chinese; one with a blockquote, a chapter style element and inline SVG.

`generate.mjs` writes it from scratch and packs it with `../odf/pack.mjs` (`mimetype` first and stored, fixed timestamps), so the output is byte-for-byte reproducible:

```sh
node examples/epub/generate.mjs [--out dir]
```

The script fails if the file reaches 200 KB. The text and artwork are original. License: MIT.
