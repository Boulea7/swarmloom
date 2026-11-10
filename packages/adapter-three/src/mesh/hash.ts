/**
 * Fixed-capacity open-addressing table mapping integer triples to dense ids (0, 1, 2, ...).
 *
 * Used for welding (quantized positions), vertex-cluster decimation (grid cells) and
 * triangle de-duplication. Typed arrays keep it allocation-free per lookup.
 */
export class TripleTable {
  readonly #keys: Int32Array;
  readonly #ids: Int32Array;
  readonly #mask: number;
  readonly #capacity: number;
  #size = 0;

  /** @param capacity Maximum number of distinct triples that will be inserted. */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError(`invalid table capacity ${capacity}`);
    let slots = 16;
    while (slots < capacity * 2) slots *= 2;
    this.#keys = new Int32Array(slots * 3);
    this.#ids = new Int32Array(slots).fill(-1);
    this.#mask = slots - 1;
    this.#capacity = capacity;
  }

  /** Number of distinct triples inserted so far. */
  get size(): number {
    return this.#size;
  }

  /** Returns the id of (a, b, c), assigning the next dense id when the triple is new. */
  idOf(a: number, b: number, c: number): number {
    let slot = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & this.#mask;
    const keys = this.#keys;
    const ids = this.#ids;
    for (;;) {
      const id = ids[slot] as number;
      if (id < 0) {
        if (this.#size >= this.#capacity) throw new RangeError("TripleTable capacity exceeded");
        const k = slot * 3;
        keys[k] = a;
        keys[k + 1] = b;
        keys[k + 2] = c;
        ids[slot] = this.#size;
        return this.#size++;
      }
      const k = slot * 3;
      if (keys[k] === a && keys[k + 1] === b && keys[k + 2] === c) return id;
      slot = (slot + 1) & this.#mask;
    }
  }
}
