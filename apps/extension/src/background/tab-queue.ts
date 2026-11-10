/**
 * Serializes work per tab so rapid clicks, shortcuts and menu picks never interleave their
 * probe -> inject steps. A failed task does not block the next one.
 */
export class TabQueue {
  readonly #tails = new Map<number, Promise<unknown>>();

  /** Runs `task` after every earlier task of the same tab has settled. */
  run<T>(tabId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(tabId) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(tabId, tail);
    void tail.then(() => {
      if (this.#tails.get(tabId) === tail) this.#tails.delete(tabId);
    });
    return result;
  }

  /** Number of tabs with queued or running work (for tests). */
  get size(): number {
    return this.#tails.size;
  }
}
