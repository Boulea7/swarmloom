import type { Plugin } from "./types";

/**
 * Declares a choreography/renderer plugin. Identity at runtime; exists for type inference
 * and as a stable hook for future validation.
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
