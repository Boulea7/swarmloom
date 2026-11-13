---
"swarmloom": patch
---

Web-page snapshots and renders keep a finite animation that the page restarts from its end handler (a class or `style.animation` toggled back, a transition toggled on `transitionend`, a new Web Animation from `onfinish`) at its end, also when that handler listens in the capture phase at the window or at an open shadow root, instead of capturing the last restart at a pose that depends on wall time. Two renders of such a URL now build the same blueprint.
