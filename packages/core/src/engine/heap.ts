/**
 * Binary min-heap of integer ids ordered by an external key array (ties by smaller id, so the
 * order is fully deterministic). Fixed capacity, no allocation after construction.
 */
export class IndexHeap {
  readonly #items: Int32Array;
  readonly #keys: ArrayLike<number>;
  #size = 0;

  constructor(capacity: number, keys: ArrayLike<number>) {
    this.#items = new Int32Array(Math.max(1, capacity));
    this.#keys = keys;
  }

  get size(): number {
    return this.#size;
  }

  clear(): void {
    this.#size = 0;
  }

  /** Smallest id by key, or -1 when empty. */
  peek(): number {
    return this.#size > 0 ? (this.#items[0] as number) : -1;
  }

  push(id: number): void {
    if (this.#size >= this.#items.length) throw new RangeError("IndexHeap capacity exceeded");
    const items = this.#items;
    let i = this.#size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent] as number;
      if (!this.#less(id, p)) break;
      items[i] = p;
      i = parent;
    }
    items[i] = id;
  }

  /** Removes and returns the smallest id, or -1 when empty. */
  pop(): number {
    if (this.#size === 0) return -1;
    const items = this.#items;
    const top = items[0] as number;
    const last = items[--this.#size] as number;
    const size = this.#size;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= size) break;
      const right = left + 1;
      let child = left;
      if (right < size && this.#less(items[right] as number, items[left] as number)) child = right;
      const c = items[child] as number;
      if (!this.#less(c, last)) break;
      items[i] = c;
      i = child;
    }
    if (size > 0) items[i] = last;
    return top;
  }

  #less(a: number, b: number): boolean {
    const ka = this.#keys[a] as number;
    const kb = this.#keys[b] as number;
    return ka < kb || (ka === kb && a < b);
  }
}
