---
"@swarmloom/export": patch
---

The in-browser frame rasteriser draws four more pages right. A scrolled page was shifted twice, so the go-live tail of an HTML export showed blank space past the end of the page; it now shows the page at its scroll position. An `<input value>`, a checked checkbox or a selected `<option>` wrote its attribute twice, and the frame failed to decode, so the whole export failed; each is now written once, with its live state. Open shadow roots attached by the parser (declarative shadow DOM) or in the live page are now flattened instead of drawing the host's light DOM. An SVG `<style>` is no longer copied into the frame, where its rules reached every element instead of only its own tree.
