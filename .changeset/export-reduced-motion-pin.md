---
"@swarmloom/export": patch
---

Exporting in the browser no longer follows the system's reduced motion setting or the screen's pixel density. The hidden export frame took both from the page, so with reduced motion on, a 3D model skipped its finale orbit and an HTML page's `@media (prefers-reduced-motion)` rules applied, and on a high-density screen `@media (min-resolution: 2dppx)` rules applied; the frames differed from the CLI's and from other users' exports. The frame now sees no preference and one device pixel per CSS px, as the CLI's browser does; reduced motion in an export comes only from the `reducedMotion` setting. Text anti-aliasing and images picked by `srcset` still follow the screen.
