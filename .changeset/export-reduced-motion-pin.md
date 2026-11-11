---
"@swarmloom/export": patch
---

Exporting in the browser no longer follows the system's reduced motion setting. The hidden export frame took it from the page, so with reduced motion on, a 3D model skipped its finale orbit and an HTML page's `@media (prefers-reduced-motion)` rules applied, and the frames differed from the CLI's and from other users' exports. The frame now sees no preference, as the CLI's browser does; reduced motion in an export comes only from the `reducedMotion` setting.
