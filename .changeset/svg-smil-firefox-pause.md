---
"@swarmloom/adapter-svg": patch
---

In Firefox, an SVG's SMIL animation now stays on the player's time between frames. Before, it kept running on the wall clock, so two in-page exports of the same drawing (for example `shuttle.svg`) gave different frames.
