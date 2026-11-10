/** `tracker.js` entry: installs the context-click tracker once per frame (repeat injections are no-ops). */

import { getApi } from "../shared/api";
import { installTracker } from "./tracker";

installTracker(globalThis as unknown as Record<string, unknown>, document, window, getApi());
