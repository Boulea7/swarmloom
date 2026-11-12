# DOCX sample

`report.docx` is written by `generate.py` (next to it). Its text, table, picture, footnote, header and
footer are this project's own and MIT like the rest of the repository.

The script calls python-docx's `Document()` without a path, so it starts from python-docx's default
template and keeps parts of it. With python-docx 1.2.0 (template `docx/templates/default.docx`, SHA-256
`2094b5bddffe9cf973d61fe03388413804f034160718494a65db7e98da40d35d`):

- Copied unchanged: `word/stylesWithEffects.xml`, `word/theme/theme1.xml`, `word/fontTable.xml`,
  `word/webSettings.xml`, `docProps/app.xml`, `customXml/item1.xml` and `customXml/itemProps1.xml`.
- Copied and edited: `word/styles.xml`, `word/settings.xml`, `word/numbering.xml`, `word/document.xml`,
  `docProps/core.xml`, the relationship parts and `[Content_Types].xml`.

- Source: https://github.com/python-openxml/python-docx, release 1.2.0 from PyPI
  (`python_docx-1.2.0-py3-none-any.whl`).
- Licence: MIT, Copyright (c) 2013 Steve Canny (full text below).

## Licence

```
The MIT License (MIT)
Copyright (c) 2013 Steve Canny, https://github.com/scanny

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
