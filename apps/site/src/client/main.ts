/**
 * Page entry. Everything here is progressive enhancement: the static HTML is complete without it.
 * The element bundle (`@swarmloom/element` and the engine behind it) is imported only after the
 * load event, when the main thread is idle, so it never competes with first paint.
 */

import { afterLoad, whenIdle } from "./env";
import { initHero } from "./hero";
import { initClips, initFilm } from "./media";
import { observeNav, observeReveals, observeScenes } from "./observe";
import { initCopy, initStrip } from "./ui";

observeReveals();
observeNav();
observeScenes();
initCopy();
initStrip();
initFilm();

afterLoad(() => {
  initClips();
  whenIdle(() => {
    void initHero({ load: () => import("@swarmloom/element") });
  });
});
