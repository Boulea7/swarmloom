---
"@swarmloom/formats": patch
"@swarmloom/studio": patch
---

Lottie JSON passed as text under a `.json` name is detected as Lottie, as its bytes already were: registry `sniff` hooks now also see the UTF-8 head of text inputs. Studio, which hands textual files, links and shares over as text, opens such files as an animation instead of source code, and no longer holds them to the 2 MB code limit.
