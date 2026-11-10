import type { PlayerEvent } from "../types";

type Listener = (e: PlayerEvent) => void;

/**
 * Typed event hub for {@link PlayerEvent}s. A throwing listener never breaks the engine or
 * the other listeners: its error is rethrown asynchronously so it still reaches the host's
 * error reporting.
 */
export class Emitter {
  readonly #listeners = new Map<PlayerEvent["type"], Set<Listener>>();

  on<T extends PlayerEvent["type"]>(type: T, fn: (e: Extract<PlayerEvent, { type: T }>) => void): () => void {
    if (typeof fn !== "function") throw new TypeError("on() needs a listener function");
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    const listener = fn as Listener;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** True when someone listens to `type` (lets hot paths skip building events). */
  has(type: PlayerEvent["type"]): boolean {
    const set = this.#listeners.get(type);
    return set !== undefined && set.size > 0;
  }

  emit(event: PlayerEvent): void {
    const set = this.#listeners.get(event.type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(event);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
