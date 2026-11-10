import { type ExtensionApi, getApi } from "../shared/api";
import { BUILD_TARGET } from "../shared/build-info";
import { type Background, createBackground } from "./controller";

/** A running background: the API it is bound to and its controller. */
export interface StartedBackground {
  api: ExtensionApi;
  background: Background;
}

/**
 * Creates the controller for the build target and registers every listener synchronously.
 * Returns null outside an extension context (for example when the bundle is loaded by a test page).
 */
export function startBackground(): StartedBackground | null {
  const api = getApi();
  if (!api) return null;
  const background = createBackground(api, { target: BUILD_TARGET });
  background.register();
  return { api, background };
}
