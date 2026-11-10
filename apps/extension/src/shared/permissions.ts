/**
 * Optional host access for the bundled Studio. When Studio runs inside the extension and is asked
 * to load `?src=<url>`, it needs the extension's permission for that origin (CORS-free fetch).
 * The request covers one origin at a time and is only made where the manifest declares
 * `<all_urls>` as optional, which keeps install-time permissions minimal.
 */

import type { ExtensionApi } from "./api";
import { BUNDLED_STUDIO } from "./build-info";
import { originPattern } from "./links";

/** Whether asking for per-origin access makes sense in this build and browser. */
export function canRequestOrigins(api: ExtensionApi): boolean {
  if (BUNDLED_STUDIO === "" || typeof api.permissions?.request !== "function") return false;
  const manifest = api.runtime.getManifest();
  return [...(manifest.optional_host_permissions ?? []), ...(manifest.optional_permissions ?? [])].includes(
    "<all_urls>",
  );
}

/**
 * Requests access to the origin of `src`. Call it synchronously from a user input handler (Firefox
 * and Safari only prompt inside the gesture); it never throws and resolves to false when declined
 * or not applicable.
 */
export function requestSourceAccess(api: ExtensionApi, src: string): Promise<boolean> {
  const pattern = originPattern(src);
  if (!pattern || !canRequestOrigins(api) || !api.permissions) return Promise.resolve(false);
  try {
    return api.permissions.request({ origins: [pattern] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
