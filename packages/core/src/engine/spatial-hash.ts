/**
 * Uniform-grid spatial hash for neighbour queries over an unbounded plane.
 *
 * Points are bucketed by cell into a power-of-two table with a counting sort, so a rebuild is
 * O(n + table) with no allocation once the capacity is reached. Each point remembers its cell,
 * so two cells that collide in the same bucket never yield duplicates or false neighbours.
 */
export class SpatialHash {
  readonly cellSize: number;
  #capacity = 0;
  #mask = 0;
  #count = 0;
  /** Bucket b holds sorted[start[b] .. start[b + 1]). */
  #start = new Int32Array(1);
  #cursor = new Int32Array(0);
  #sorted = new Int32Array(0);
  #cellX = new Int32Array(0);
  #cellY = new Int32Array(0);
  #bucketOf = new Int32Array(0);
  #xs: ArrayLike<number> = [];
  #ys: ArrayLike<number> = [];

  constructor(cellSize: number, capacity = 64) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError("cellSize must be a positive number");
    this.cellSize = cellSize;
    this.#grow(capacity);
  }

  get size(): number {
    return this.#count;
  }

  /**
   * Indexes points `0..count-1` of `xs`/`ys`. The arrays are referenced, not copied:
   * rebuild again after changing them. Non-finite coordinates are not supported.
   */
  rebuild(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    if (count > this.#capacity) this.#grow(count);
    this.#xs = xs;
    this.#ys = ys;
    this.#count = count;
    const table = this.#mask + 1;
    const start = this.#start;
    start.fill(0);
    const inv = 1 / this.cellSize;
    for (let i = 0; i < count; i++) {
      const cx = Math.floor((xs[i] as number) * inv);
      const cy = Math.floor((ys[i] as number) * inv);
      const b = this.#bucket(cx, cy);
      this.#cellX[i] = cx;
      this.#cellY[i] = cy;
      this.#bucketOf[i] = b;
      start[b + 1] = (start[b + 1] as number) + 1;
    }
    for (let b = 0; b < table; b++) start[b + 1] = (start[b + 1] as number) + (start[b] as number);
    const cursor = this.#cursor;
    cursor.set(start.subarray(0, table));
    for (let i = 0; i < count; i++) {
      const b = this.#bucketOf[i] as number;
      const slot = cursor[b] as number;
      cursor[b] = slot + 1;
      this.#sorted[slot] = i;
    }
  }

  /**
   * Writes the indices of points within `radius` of (x, y) (inclusive), ascending within each
   * cell, into `out`.
   * @returns The number of indices written (capped at `out.length`).
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    if (this.#count === 0 || !(radius >= 0)) return 0;
    const inv = 1 / this.cellSize;
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) * inv);
    const x1 = Math.floor((x + radius) * inv);
    const y0 = Math.floor((y - radius) * inv);
    const y1 = Math.floor((y + radius) * inv);
    const start = this.#start;
    const xs = this.#xs;
    const ys = this.#ys;
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.#bucket(cx, cy);
        const end = start[b + 1] as number;
        for (let k = start[b] as number; k < end; k++) {
          const i = this.#sorted[k] as number;
          if (this.#cellX[i] !== cx || this.#cellY[i] !== cy) continue;
          const dx = (xs[i] as number) - x;
          const dy = (ys[i] as number) - y;
          if (dx * dx + dy * dy > r2) continue;
          if (n >= out.length) return n;
          out[n++] = i;
        }
      }
    }
    return n;
  }

  #bucket(cx: number, cy: number): number {
    return (Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca77)) & this.#mask;
  }

  #grow(capacity: number): void {
    this.#capacity = Math.max(16, capacity);
    let table = 16;
    while (table < this.#capacity * 2) table *= 2;
    this.#mask = table - 1;
    this.#start = new Int32Array(table + 1);
    this.#cursor = new Int32Array(table);
    this.#sorted = new Int32Array(this.#capacity);
    this.#cellX = new Int32Array(this.#capacity);
    this.#cellY = new Int32Array(this.#capacity);
    this.#bucketOf = new Int32Array(this.#capacity);
  }
}
