/** Items to cluster: triangle centroids (with normals) or cloud points. */
export interface ClusterInput {
  /** 3 floats per item. */
  positions: Float32Array;
  /** Optional unit normal per item (3 floats); folded into the distance so thin parts split front from back. */
  normals?: Float32Array | null;
}

export interface ClusterOptions {
  /** Upper bound on the number of clusters. */
  k: number;
  /** Weight of the normal term relative to position (model radius ~1). Default 0.35. */
  normalWeight?: number;
  /** Lloyd iterations on the sample. Default 6. */
  iterations?: number;
  /** Items used for seeding and iterations; the final assignment always covers every item. Default 12 000. */
  sampleLimit?: number;
}

/** Result of {@link clusterItems}: every item has exactly one label and every cluster is non-empty. */
export interface Clusters {
  count: number;
  /** Cluster index per item, in 0..count-1. */
  labels: Uint32Array;
  /** Mean position per cluster (3 floats). */
  centers: Float32Array;
  /** Items per cluster. */
  sizes: Uint32Array;
}

const DIM = 6;

function features(input: ClusterInput, index: number, weight: number, out: Float64Array, at: number): void {
  const p = input.positions;
  const n = input.normals;
  out[at] = p[index * 3] as number;
  out[at + 1] = p[index * 3 + 1] as number;
  out[at + 2] = p[index * 3 + 2] as number;
  out[at + 3] = n ? (n[index * 3] as number) * weight : 0;
  out[at + 4] = n ? (n[index * 3 + 1] as number) * weight : 0;
  out[at + 5] = n ? (n[index * 3 + 2] as number) * weight : 0;
}

function distance2(a: Float64Array, ai: number, b: Float64Array, bi: number): number {
  let d = 0;
  for (let i = 0; i < DIM; i++) {
    const x = (a[ai + i] as number) - (b[bi + i] as number);
    d += x * x;
  }
  return d;
}

function nearest(point: Float64Array, at: number, centers: Float64Array, k: number): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let c = 0; c < k; c++) {
    const d = distance2(point, at, centers, c * DIM);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Deterministic k-means: farthest-point seeding on an evenly strided sample, a few Lloyd
 * iterations, then one assignment pass over all items. Empty clusters are dropped, so
 * `count <= min(k, items)`. Same input always yields the same labels (no randomness).
 */
export function clusterItems(input: ClusterInput, options: ClusterOptions): Clusters {
  const n = Math.floor(input.positions.length / 3);
  if (!Number.isFinite(options.k) || options.k < 1) throw new RangeError("cluster count k must be >= 1");
  if (n === 0) return { count: 0, labels: new Uint32Array(0), centers: new Float32Array(0), sizes: new Uint32Array(0) };
  const weight = options.normalWeight ?? 0.35;
  const iterations = options.iterations ?? 6;
  const m = Math.min(n, Math.max(1, options.sampleLimit ?? 12_000));
  const sample = new Float64Array(m * DIM);
  for (let j = 0; j < m; j++) features(input, Math.floor((j * n) / m), weight, sample, j * DIM);

  // Farthest-point seeding starting from the sample farthest from the sample mean.
  const mean = new Float64Array(DIM);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < DIM; i++) mean[i] = (mean[i] as number) + (sample[j * DIM + i] as number) / m;
  const minD = new Float64Array(m);
  let first = 0;
  let firstD = -1;
  for (let j = 0; j < m; j++) {
    const d = distance2(sample, j * DIM, mean, 0);
    if (d > firstD) {
      firstD = d;
      first = j;
    }
  }
  const kMax = Math.min(Math.floor(options.k), m);
  const centers = new Float64Array(kMax * DIM);
  centers.set(sample.subarray(first * DIM, first * DIM + DIM), 0);
  for (let j = 0; j < m; j++) minD[j] = distance2(sample, j * DIM, centers, 0);
  let k = 1;
  while (k < kMax) {
    let pick = -1;
    let pickD = 0;
    for (let j = 0; j < m; j++) {
      if ((minD[j] as number) > pickD) {
        pickD = minD[j] as number;
        pick = j;
      }
    }
    if (pick < 0) break; // every remaining sample coincides with a seed
    centers.set(sample.subarray(pick * DIM, pick * DIM + DIM), k * DIM);
    for (let j = 0; j < m; j++) {
      const d = distance2(sample, j * DIM, centers, k * DIM);
      if (d < (minD[j] as number)) minD[j] = d;
    }
    k++;
  }

  // Lloyd iterations on the sample.
  const sums = new Float64Array(k * DIM);
  const counts = new Uint32Array(k);
  for (let it = 0; it < iterations && k > 1; it++) {
    sums.fill(0);
    counts.fill(0);
    for (let j = 0; j < m; j++) {
      const c = nearest(sample, j * DIM, centers, k);
      counts[c] = (counts[c] as number) + 1;
      for (let i = 0; i < DIM; i++) sums[c * DIM + i] = (sums[c * DIM + i] as number) + (sample[j * DIM + i] as number);
    }
    for (let c = 0; c < k; c++) {
      const size = counts[c] as number;
      if (size === 0) continue; // keep the previous centre; dropped later if it stays empty
      for (let i = 0; i < DIM; i++) centers[c * DIM + i] = (sums[c * DIM + i] as number) / size;
    }
  }

  // Final assignment of every item.
  const raw = new Uint32Array(n);
  const rawSizes = new Uint32Array(k);
  const point = new Float64Array(DIM);
  for (let index = 0; index < n; index++) {
    features(input, index, weight, point, 0);
    const c = nearest(point, 0, centers, k);
    raw[index] = c;
    rawSizes[c] = (rawSizes[c] as number) + 1;
  }

  // Compact away empty clusters, keeping centre order.
  const remap = new Int32Array(k).fill(-1);
  let count = 0;
  for (let c = 0; c < k; c++) if ((rawSizes[c] as number) > 0) remap[c] = count++;
  const labels = new Uint32Array(n);
  const sizes = new Uint32Array(count);
  const outCenters = new Float32Array(count * 3);
  const acc = new Float64Array(count * 3);
  const p = input.positions;
  for (let index = 0; index < n; index++) {
    const label = remap[raw[index] as number] as number;
    labels[index] = label;
    sizes[label] = (sizes[label] as number) + 1;
    acc[label * 3] = (acc[label * 3] as number) + (p[index * 3] as number);
    acc[label * 3 + 1] = (acc[label * 3 + 1] as number) + (p[index * 3 + 1] as number);
    acc[label * 3 + 2] = (acc[label * 3 + 2] as number) + (p[index * 3 + 2] as number);
  }
  for (let c = 0; c < count; c++) {
    const size = sizes[c] as number;
    outCenters[c * 3] = (acc[c * 3] as number) / size;
    outCenters[c * 3 + 1] = (acc[c * 3 + 1] as number) / size;
    outCenters[c * 3 + 2] = (acc[c * 3 + 2] as number) / size;
  }
  return { count, labels, centers: outCenters, sizes };
}

/** Default patch count for a model: about one patch per `perPatch` items, within [min, max]. */
export function targetPatchCount(items: number, max: number, perPatch = 150, min = 6): number {
  if (items <= 0) return 0;
  return Math.max(1, Math.min(max, items, Math.max(min, Math.round(items / perPatch))));
}
