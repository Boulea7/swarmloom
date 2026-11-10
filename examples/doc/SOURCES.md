# Word 97-2003 samples

`report.doc` is this project's own sample: `generate.py` (next to it, Python standard library only)
writes it byte by byte from the published MS-DOC and MS-CFB specifications, so it is MIT like the
rest of the repository. Run `python3 examples/doc/generate.py` from the repository root to rebuild it;
the output is reproducible. It has a title, headings, Chinese and Latin text, a footnote, a hyperlink,
a bordered table, a header and footer, an explicit page break and a landscape second section (three
sheets). It is checked by SwarmLoom's parser and by word-extractor's text extraction, but it has not
been opened in Microsoft Word.

The two other files are real `.doc` files saved by Microsoft Word, used by the `@swarmloom/adapter-doc`
tests. They are copied unchanged (byte for byte) from the test data of the MIT-licensed
`word-extractor` project; nothing in SwarmLoom's code is derived from that project.

| File | Original path | Size | SHA-256 |
| --- | --- | --- | --- |
| `headers-footers-unicode.doc` | `__tests__/data/test04.doc` | 28,672 bytes | `8bd7fc9552bccb7b71a0dc34ffd801e7d3547d1317fd75d0c35fca3572f6fa4b` |
| `table.doc` | `__tests__/data/test03.doc` | 33,280 bytes | `36887f9fe1e7b792abe991a9767630e96d5446ec36a12e237b7a9c3f1356f5e7` |

- Source: https://github.com/morungos/node-word-extractor (branch `main`), files under
  https://github.com/morungos/node-word-extractor/tree/main/__tests__/data
- Licence: MIT, Copyright (c) 2016-2021 Stuart Watt (full text below).
- Retrieved: 2026-11-10.

What they contain (per the project's `__tests__/data/manifest.md` and our parser):

- `headers-footers-unicode.doc`: two pages split by an explicit page break, a header and a footer
  with non-ASCII text (euro sign, "Molière"), one Heading 1 paragraph, 12 body paragraphs.
- `table.doc`: one paragraph followed by a 5 x 6 table of licence names.

## Licence

```
The MIT License (MIT)

Copyright (c) 2016-2021 Stuart Watt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
