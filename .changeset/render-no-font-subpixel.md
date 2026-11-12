---
"swarmloom": patch
---

`render` with `--scale` above 1 gives the same frames every time again: text that the build grows to a new size (such as a heading) no longer sits one pixel higher or lower in some takes than in others. The browser now runs without font subpixel positioning, so text in renders above scale 1 can sit up to a pixel apart from renders made with earlier versions.
