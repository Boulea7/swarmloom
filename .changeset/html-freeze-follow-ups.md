---
"@swarmloom/adapter-html": minor
---

The HTML capture also freezes the transitions and animations that its own frozen poses set off, such as an em-based width that follows a paused font size, or a container query that matches at the frozen size, and the ones those set off in turn, pass after pass until a pass finds no new one. Before, they ran on wall time, so CLI renders, Studio and in-browser exports of the same page, seed and settings gave different blueprints and frames from run to run. A page that still starts new ones after 32 passes keeps the last ones running; it gets a warning, and `FrozenAnimations.settled` is false.
