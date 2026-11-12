---
"@swarmloom/core": minor
"@swarmloom/export": minor
"swarmloom": minor
---

Takes repeat exactly and close-ups read cleanly. Two CLI renders with the same input, seed and flags give the same frame hashes at every `--scale` (at 0.5, 2.5, 3 and 3.5 some anti-aliased edges came out one shade apart; at those scales each screenshot now waits until the browser has rastered the frame), and the manifest's `blueprintSha256` stays the same from run to run (the served input address, links resolved against the render page and `blob:` URLs are normalized before hashing). The new `--overlays full|minimal|none` (`PlayerOptions.overlays`) leaves out size badges, distance labels, guides and rulers, or every editing mark. Name tags stay inside the frame at its right and bottom edges, and in `roles` mode a PDF text line that is typed in reads Type, not Image.
