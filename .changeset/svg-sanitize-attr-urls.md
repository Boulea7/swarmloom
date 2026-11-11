---
"@swarmloom/adapter-svg": patch
---

The SVG sanitiser now removes presentation attributes and SMIL values that load files from outside the document in disguise. It decodes CSS escapes before it checks a value, so `fill="u\72l(https://…)"` is dropped like a plain `url()`. It also drops a `url(` left open after a fragment reference and the functions that take a bare URL string, `image-set()` and `src()`. Before, values such as `mask="image-set('https://…' 1x)"` or `<set attributeName="mask" to="image-set(…)">` were kept and the browser fetched them while it laid out the drawing.
