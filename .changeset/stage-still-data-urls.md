---
"@swarmloom/core": patch
---

The stage no longer decodes every inlined (`data:`) image again each time it mounts the layer, on replays, seeks back and when a long page scrolls layers back in. It remembers which inlined images have no animation, and the still copy of an animated SVG, so HTML captures with large inline SVG charts or GIFs no longer spend milliseconds per image in the frame that mounts them.
