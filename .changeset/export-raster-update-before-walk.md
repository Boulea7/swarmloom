---
"@swarmloom/export": patch
---

A browser export now draws the frame right after a scroll or a layout change with what the engine takes at its next rendering update (scroll-state container queries, anchor positions and their fallbacks), as `swarmloom render` does. That frame used to show this state from before or after the update depending on timing, so on a page with a scroll-state sticky header the go-live frame could show the header unstuck. A frame that walks after a change now waits for that update first: at most a display frame, about 0.5 to 2.5 ms a walk in headless Chromium at 1280x720, so exports of `examples/markdown/welcome.zh.md` and `examples/web/demo.html` take about 1% longer and a long live page with a spinner about 5%, with the same frames. In a hidden tab, which takes no rendering updates, frames do not wait and keep that state as the engine last took it.
