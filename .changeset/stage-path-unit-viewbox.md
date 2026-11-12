---
"@swarmloom/core": patch
"swarmloom": patch
---

Vector path layers now draw their viewBox at exactly scale 1. The svg of a path took its box size as laid out, rounded to 1/64 px (431.17 px became 431.15625 px), while its viewBox kept the exact size; Chromium computed the small scale between them one float step apart from one paint to the next, so the antialiased end of a line could differ by one colour level between two renders of the same frame. With `swarmloom render --scale 1.5`, two renders of `examples/html/landing.html` gave different frame hashes (the divider of the hero card, frames 120–165); they now match. The svg and its viewBox now share one size in whole layout units.
