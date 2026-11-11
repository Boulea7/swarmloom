---
"@swarmloom/export": patch
---

The render page's `blueprintSha256` (the `input.blueprintSha256` of `render --manifest-out`) is now the same for every take of the same input and settings even when the blueprint holds URLs on the render page's own origin, such as Markdown footnote links and their back links: the random port of the local server no longer reaches the hash.
