---
"@swarmloom/adapter-html": patch
"@swarmloom/core": patch
---

The HTML capture reads a page's animations a second time only where its rules let a frozen pose start a transition or an animation (keyframes that change a value a transition or a size container there can take, or a finished transition's own property), as the export's go-live seek does. Pages with only fades, slides and pulses load as fast as before the follow-up freeze again: one with 5000 cards and a staggered entrance took a third longer. `readStyleFacts` and `mayStartAnimations`, which both packages use, are exported from `@swarmloom/core`.
