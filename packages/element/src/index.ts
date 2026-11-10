/**
 * @swarmloom/element: the `<swarm-loom>` Web Component.
 *
 * Importing this module has no side effects and touches no DOM (safe in SSR); call {@link define}
 * in the browser to register the tag. The CDN build `dist/swarm-loom.global.js` registers it itself.
 */

import { SwarmLoomElement } from "./element";

export type { ElementConfig } from "./attributes";
export { readConfig } from "./attributes";
export { SwarmLoomElement, type SwarmLoomEventDetails } from "./element";
export { configure, type ElementRuntime, runtime } from "./runtime";

/** Default tag name registered by {@link define}. */
export const TAG_NAME = "swarm-loom";

/**
 * Registers {@link SwarmLoomElement} as `<swarm-loom>`. Safe to call more than once.
 *
 * @param registry Custom element registry. Default `globalThis.customElements`.
 * @returns The registered constructor.
 * @throws Error when custom elements are unavailable or the tag belongs to another class.
 */
export function define(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): typeof SwarmLoomElement {
  if (!registry) throw new Error("customElements is not available in this environment");
  const existing = registry.get(TAG_NAME);
  if (existing === SwarmLoomElement) return SwarmLoomElement;
  if (existing) throw new Error(`<${TAG_NAME}> is already defined by another class`);
  registry.define(TAG_NAME, SwarmLoomElement);
  return SwarmLoomElement;
}
