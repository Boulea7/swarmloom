---
"@swarmloom/export": patch
---

On go live, animations the live page started after the capture froze it (CSS animations in `content-visibility: auto` sections, which Chromium creates only once a section is laid out) are frozen by the capture's rule first: finite ones at their end, loops half a cycle in. Before, the go-live seek anchored them wherever wall time had taken them, so CLI renders and in-browser exports of such pages gave different frames from go live on (44 of 132 in one case).
