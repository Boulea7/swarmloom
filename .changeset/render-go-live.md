---
"swarmloom": minor
"@swarmloom/export": minor
"@swarmloom/adapter-svg": patch
---

Rendered videos go live after the build: once the finale settles the cursors leave and the finished page keeps playing its own animations through `--tail`. An HTML document swaps in the real page (its CSS animations resume from the captured pose), SVG SMIL keeps playing and plugin players such as Lottie keep running. Every animation is paused and seeked to the frame time, so the same input and seed still give byte-identical frames. `--no-live` keeps the finale through the whole tail; reduced motion keeps the end state. `createSvgAdapter({ liveClock: "player" })` keeps SMIL replays on player time after go live.
