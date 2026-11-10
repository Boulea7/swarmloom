# Web page sample

`demo.html` is a self-contained dashboard page written for this repository (no network requests, no external fonts or images). It is the fixture of the `@swarmloom/snapshot-dom` browser tests and a test bed for the `dom` adapter. It covers:

- an app shell whose main column scrolls inside the viewport, with a sticky top bar and a fixed help button;
- grid and flex cards, a float in the article, a rule and single-side borders;
- eight repeated pattern cards, stat tiles and nav links for duplicate detection;
- a form with text, e-mail, password, select, textarea, checkbox, radio and range controls;
- a 2D canvas drawn by a small deterministic script, inline SVG icons and an SVG favicon;
- a custom element with an open shadow root and a slot, `::before`/`::after` badges from `attr()`;
- long article text and visually hidden helper text that must not be captured.

Open it directly in a browser to see the original. The text and artwork are original. License: MIT.
