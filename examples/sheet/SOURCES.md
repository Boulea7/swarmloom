# Sheet samples

`sales.xlsx` and `cities.csv` are written by `generate_samples.py` (next to it). Their data, layout
and styles are this project's own (all figures are invented) and MIT like the rest of the repository.

One part of `sales.xlsx` comes from openpyxl: `xl/theme/theme1.xml` (10,140 bytes) is the fixed
`theme_xml` string of `openpyxl/writer/theme.py`, which openpyxl 3.1.5 writes unchanged into every
workbook.

- Source: https://foss.heptapod.net/openpyxl/openpyxl, release 3.1.5 from PyPI
  (`openpyxl-3.1.5-py2.py3-none-any.whl`).
- Licence: MIT, Copyright (c) 2010 openpyxl (full text below).

## Licence

```
This software is under the MIT Licence
======================================

Copyright (c) 2010 openpyxl

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
