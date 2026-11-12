---
"@swarmloom/adapter-three": patch
---

The 3D scene follows the player's reduced motion setting (`StageApi.reducedMotion`) instead of reading `prefers-reduced-motion` itself, so an explicit setting and exports decide whether the model pops in and orbits, not the machine.
