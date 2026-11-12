# PPTX sample

`pitch.pptx` is written by `generate_pitch.py` (next to it). Its slides, text, shapes and picture are
this project's own and MIT like the rest of the repository.

The script calls python-pptx's `Presentation()` without a path, so it starts from python-pptx's default
template and keeps parts of it. With python-pptx 1.0.2 (template `pptx/templates/default.pptx`, SHA-256
`e10cc9e120961f6bd4074a373c9c80d2a06c497157e8f4972977b7bea83a8f34`):

- Copied unchanged: `docProps/thumbnail.jpeg`, `docProps/app.xml`, `ppt/presProps.xml`,
  `ppt/viewProps.xml`, `ppt/tableStyles.xml` and `ppt/printerSettings/printerSettings1.bin`.
- Copied and edited: the slide master and its eleven slide layouts (resized to 16:9), the theme
  (recoloured to the SwarmLoom palette), `ppt/presentation.xml`, `docProps/core.xml`, the
  relationship parts and `[Content_Types].xml`.

- Source: https://github.com/scanny/python-pptx, release 1.0.2 from PyPI
  (`python_pptx-1.0.2-py3-none-any.whl`).
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
