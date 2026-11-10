import type { SourceInput } from "@swarmloom/core";

/** Default tag name registered by {@link define}. */
export const TAG_NAME = "swarm-loom";

// Keep the module importable where HTMLElement does not exist (SSR, Node without a DOM).
const BaseElement: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * `<swarm-loom>`: plays a SwarmLoom build of a file or URL inside the page.
 *
 * Planned attributes: `src`, `type`, `agents`, `speed`, `seed`, `autoplay`, `loop`, `controls`,
 * `theme`, `labels`. Stub: no rendering yet.
 */
export class SwarmLoomElement extends BaseElement {
  static get observedAttributes(): string[] {
    return ["src", "type", "agents", "speed", "seed", "autoplay", "loop", "controls", "theme", "labels"];
  }

  /**
   * Loads a source (detected through `@swarmloom/formats`) and starts playback when `autoplay` is set.
   *
   * @throws Error "not implemented yet" until the element lands.
   */
  async load(input: SourceInput): Promise<void> {
    void input;
    throw new Error("not implemented yet");
  }
}

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
