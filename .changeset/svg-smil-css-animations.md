---
"@swarmloom/adapter-svg": patch
---

CSS animations in an SVG that also has SMIL animation now follow the replay's timeline instead of wall-clock time. They are held at 0 s until the replay starts and are seeked with it, so two renders of the same drawing give the same frames.
