/**
 * `swarm.js`: injected on demand by the background after it left a launch request in the
 * isolated world. Consumes the request and starts a session (the background already stopped any
 * running one, so a toolbar click toggles and a menu pick restarts).
 */

import { getApi } from "../shared/api";
import { GLOBALS, parseLaunch } from "../shared/messages";
import { contentDeps } from "./deps";
import { startSession } from "./session";

const scope = globalThis as unknown as Record<string, unknown>;
const launch = parseLaunch(scope[GLOBALS.launch]);
delete scope[GLOBALS.launch];
startSession(globalThis, document, launch, contentDeps(getApi(), window));
