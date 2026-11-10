/**
 * Background entry for store builds (MV3 service worker, Firefox event page, Firefox Android MV2
 * event page). Listeners are registered synchronously at the top level so a woken worker sees the
 * event that woke it.
 */

import { startBackground } from "./start";

startBackground();
