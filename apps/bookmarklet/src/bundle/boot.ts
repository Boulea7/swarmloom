import { GLOBAL_KEY, SCRIPT_ID } from "../protocol";
import { type ControllerDeps, createController } from "./controller";

/**
 * Registers the bookmarklet handle on `window` and, when the loader's script element is still
 * in the page, starts a rebuild with the options from its `data-swarmloom-bm` attribute.
 *
 * A missing script element means the loader already gave up (CSP signal or timeout, the page went
 * to the Studio) or a later click retried: the handle is registered anyway, so the next click
 * toggles instantly instead of loading the bundle again.
 */
export function bootBookmarklet(deps: ControllerDeps): void {
  if (Object.hasOwn(deps.win, GLOBAL_KEY)) return;
  const handle = createController(deps);
  Object.defineProperty(deps.win, GLOBAL_KEY, { value: handle, configurable: true });
  const script = deps.doc.getElementById(SCRIPT_ID);
  if (script?.tagName === "SCRIPT") handle.toggle(script.dataset[SCRIPT_ID]);
}
