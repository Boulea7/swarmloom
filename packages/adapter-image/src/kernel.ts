/**
 * Pixel kernel: edge sketch and quadtree tiling of a working-size RGBA image.
 *
 * Everything lives inside {@link createKernel} on purpose: the function is self-contained (no
 * imports, no references to module scope), so its source can be shipped to a Web Worker as-is
 * (`(${createKernel})()`) and the synchronous fallback runs exactly the same code. Results are a
 * pure function of the input pixels and options, so worker and main-thread runs are identical.
 */

export interface AnalyzeOptions {
  /** Maximum sketch strokes kept (strongest first). */
  maxStrokes: number;
  /** Strokes shorter than this (working px, after simplification) are dropped. */
  minStrokeLength: number;
  /** Ramer-Douglas-Peucker tolerance in working px. */
  epsilon: number;
  /** Maximum quadtree leaves. */
  maxTiles: number;
  /** Smallest tile side in working px. */
  minTile: number;
  /** Background the image is composited on (alpha), 0..255 luma. */
  backgroundLuma: number;
}

export interface Stroke {
  /** Flat x,y list in working px. */
  points: number[];
  /** Mean gradient magnitude along the stroke, normalised 0..1. */
  strength: number;
  /** Polyline length in working px. */
  length: number;
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mean colour as #rrggbb. */
  colour: string;
  /** Detail score that drove the split (colour deviation plus edge energy). */
  detail: number;
}

export interface Analysis {
  width: number;
  height: number;
  strokes: Stroke[];
  tiles: Tile[];
  /** Mean luma 0..1 over opaque pixels. */
  meanLuma: number;
  /** True when some pixel is not fully opaque. */
  hasAlpha: boolean;
  /** Edge pixels found before linking (diagnostics). */
  edgePixels: number;
  /** Strokes that passed the length filter before `maxStrokes` was applied. */
  strokeCandidates: number;
}

export interface Kernel {
  analyze(rgba: Uint8ClampedArray, width: number, height: number, opts: AnalyzeOptions): Analysis;
  /** Luma (0..255) composited over a background luma. */
  luma(rgba: Uint8ClampedArray, width: number, height: number, backgroundLuma: number): Float32Array;
  /** Separable Gaussian blur, sigma about 1.1 (5 taps). */
  blur(src: Float32Array, width: number, height: number): Float32Array;
  /** Sobel gradient magnitude and quantised direction (0: horizontal edge normal .. 3). */
  sobel(src: Float32Array, width: number, height: number): { mag: Float32Array; dir: Uint8Array };
  /** Non-maximum suppression along the gradient direction. */
  suppress(mag: Float32Array, dir: Uint8Array, width: number, height: number): Float32Array;
  /** Double threshold with hysteresis; returns a 0/1 edge map. */
  hysteresis(nms: Float32Array, width: number, height: number, low: number, high: number): Uint8Array;
  /** Links 8-connected edge pixels into polylines (flat x,y lists). */
  link(edges: Uint8Array, width: number, height: number): number[][];
  /** Ramer-Douglas-Peucker simplification of a flat x,y polyline. */
  simplify(points: readonly number[], epsilon: number): number[];
  /** Quadtree leaves by detail priority, at most `maxTiles`. */
  quadtree(
    rgba: Uint8ClampedArray,
    mag: Float32Array,
    width: number,
    height: number,
    maxTiles: number,
    minTile: number,
  ): Tile[];
}

/** Creates the kernel. Must stay self-contained: it is stringified into a worker. */
export function createKernel(): Kernel {
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];

  function luma(rgba: Uint8ClampedArray, width: number, height: number, backgroundLuma: number): Float32Array {
    const n = width * height;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const a = (rgba[o + 3] as number) / 255;
      const y = 0.299 * (rgba[o] as number) + 0.587 * (rgba[o + 1] as number) + 0.114 * (rgba[o + 2] as number);
      out[i] = y * a + backgroundLuma * (1 - a);
    }
    return out;
  }

  function blur(src: Float32Array, width: number, height: number): Float32Array {
    const k = [0.0702, 0.2611, 0.3374, 0.2611, 0.0702];
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let t = -2; t <= 2; t++) {
          const xx = x + t < 0 ? 0 : x + t >= width ? width - 1 : x + t;
          s += (k[t + 2] as number) * (src[row + xx] as number);
        }
        tmp[row + x] = s;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let t = -2; t <= 2; t++) {
          const yy = y + t < 0 ? 0 : y + t >= height ? height - 1 : y + t;
          s += (k[t + 2] as number) * (tmp[yy * width + x] as number);
        }
        out[y * width + x] = s;
      }
    }
    return out;
  }

  function sobel(src: Float32Array, width: number, height: number): { mag: Float32Array; dir: Uint8Array } {
    const mag = new Float32Array(src.length);
    const dir = new Uint8Array(src.length);
    const at = (x: number, y: number): number => {
      const xx = x < 0 ? 0 : x >= width ? width - 1 : x;
      const yy = y < 0 ? 0 : y >= height ? height - 1 : y;
      return src[yy * width + xx] as number;
    };
    const tan22 = 0.41421356;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = at(x - 1, y - 1);
        const b = at(x, y - 1);
        const c = at(x + 1, y - 1);
        const d = at(x - 1, y);
        const f = at(x + 1, y);
        const g = at(x - 1, y + 1);
        const h = at(x, y + 1);
        const i = at(x + 1, y + 1);
        const gx = c + 2 * f + i - a - 2 * d - g;
        const gy = g + 2 * h + i - a - 2 * b - c;
        const idx = y * width + x;
        mag[idx] = Math.sqrt(gx * gx + gy * gy);
        const ax = Math.abs(gx);
        const ay = Math.abs(gy);
        // 0: gradient along x, 2: along y, 1/3: diagonals.
        if (ay <= ax * tan22) dir[idx] = 0;
        else if (ax <= ay * tan22) dir[idx] = 2;
        else dir[idx] = gx * gy > 0 ? 1 : 3;
      }
    }
    return { mag, dir };
  }

  function suppress(mag: Float32Array, dir: Uint8Array, width: number, height: number): Float32Array {
    const out = new Float32Array(mag.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const m = mag[idx] as number;
        if (m === 0) continue;
        const d = dir[idx] as number;
        let o = 1;
        if (d === 1) o = width + 1;
        else if (d === 2) o = width;
        else if (d === 3) o = width - 1;
        // Ties go to the earlier neighbour so plateaus keep exactly one pixel.
        if (m > (mag[idx - o] as number) && m >= (mag[idx + o] as number)) out[idx] = m;
      }
    }
    return out;
  }

  function hysteresis(nms: Float32Array, width: number, height: number, low: number, high: number): Uint8Array {
    const out = new Uint8Array(nms.length);
    const stack: number[] = [];
    for (let i = 0; i < nms.length; i++) {
      if ((nms[i] as number) >= high && out[i] === 0) {
        out[i] = 1;
        stack.push(i);
        while (stack.length > 0) {
          const p = stack.pop() as number;
          const px = p % width;
          const py = (p - px) / width;
          for (let k = 0; k < 8; k++) {
            const nx = px + (DX[k] as number);
            const ny = py + (DY[k] as number);
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const q = ny * width + nx;
            if (out[q] === 0 && (nms[q] as number) >= low) {
              out[q] = 1;
              stack.push(q);
            }
          }
        }
      }
    }
    return out;
  }

  function neighbours(edges: Uint8Array, width: number, height: number, p: number): number {
    const px = p % width;
    const py = (p - px) / width;
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const nx = px + (DX[k] as number);
      const ny = py + (DY[k] as number);
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && edges[ny * width + nx]) n++;
    }
    return n;
  }

  function link(edges: Uint8Array, width: number, height: number): number[][] {
    const visited = new Uint8Array(edges.length);
    const lines: number[][] = [];
    const trace = (start: number): void => {
      const pts: number[] = [];
      let p = start;
      let lastDir = -1;
      for (;;) {
        visited[p] = 1;
        const px = p % width;
        const py = (p - px) / width;
        pts.push(px, py);
        // Prefer continuing straight, then gentle turns, then sharp ones.
        let best = -1;
        let bestCost = 99;
        for (let k = 0; k < 8; k++) {
          const nx = px + (DX[k] as number);
          const ny = py + (DY[k] as number);
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!edges[q] || visited[q]) continue;
          let cost = 0;
          if (lastDir >= 0) {
            const turn = Math.abs(k - lastDir);
            cost = Math.min(turn, 8 - turn);
          }
          cost += k % 2 === 1 ? 0.1 : 0;
          if (cost < bestCost) {
            bestCost = cost;
            best = k;
          }
        }
        if (best < 0 || bestCost > 2.5) break;
        lastDir = best;
        p = (py + (DY[best] as number)) * width + px + (DX[best] as number);
      }
      if (pts.length >= 4) lines.push(pts);
    };
    // Endpoints first so open curves are traced from one end; then whatever is left (loops).
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] && !visited[i] && neighbours(edges, width, height, i) === 1) trace(i);
    }
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] && !visited[i]) trace(i);
    }
    return lines;
  }

  function simplify(points: readonly number[], epsilon: number): number[] {
    const n = points.length >> 1;
    if (n <= 2) return points.slice(0, n * 2);
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const eps2 = epsilon * epsilon;
    const stack: number[] = [0, n - 1];
    while (stack.length > 0) {
      const last = stack.pop() as number;
      const first = stack.pop() as number;
      const ax = points[first * 2] as number;
      const ay = points[first * 2 + 1] as number;
      const bx = points[last * 2] as number;
      const by = points[last * 2 + 1] as number;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1;
      let index = -1;
      for (let i = first + 1; i < last; i++) {
        const px = (points[i * 2] as number) - ax;
        const py = (points[i * 2 + 1] as number) - ay;
        let d2: number;
        if (len2 === 0) d2 = px * px + py * py;
        else {
          const cross = px * dy - py * dx;
          d2 = (cross * cross) / len2;
        }
        if (d2 > maxD) {
          maxD = d2;
          index = i;
        }
      }
      if (index >= 0 && maxD > eps2) {
        keep[index] = 1;
        stack.push(first, index, index, last);
      }
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2] as number, points[i * 2 + 1] as number);
    return out;
  }

  function polylineLength(points: readonly number[]): number {
    let len = 0;
    for (let i = 2; i < points.length; i += 2) {
      len += Math.hypot(
        (points[i] as number) - (points[i - 2] as number),
        (points[i + 1] as number) - (points[i - 1] as number),
      );
    }
    return len;
  }

  /** Mean gradient magnitude sampled along the original (unsimplified) pixels. */
  function meanAlong(points: readonly number[], mag: Float32Array, width: number): number {
    let s = 0;
    const n = points.length >> 1;
    for (let i = 0; i < n; i++) s += mag[(points[i * 2 + 1] as number) * width + (points[i * 2] as number)] as number;
    return n > 0 ? s / n : 0;
  }

  function hex(v: number): string {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return (c < 16 ? "0" : "") + c.toString(16);
  }

  function quadtree(
    rgba: Uint8ClampedArray,
    mag: Float32Array,
    width: number,
    height: number,
    maxTiles: number,
    minTile: number,
  ): Tile[] {
    // Summed-area tables: sums of r, g, b, r^2+g^2+b^2 and edge magnitude, (w+1) x (h+1).
    const W = width + 1;
    const size = W * (height + 1);
    const sr = new Float64Array(size);
    const sg = new Float64Array(size);
    const sb = new Float64Array(size);
    const sq = new Float64Array(size);
    const se = new Float64Array(size);
    for (let y = 0; y < height; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let q = 0;
      let e = 0;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const R = rgba[o] as number;
        const G = rgba[o + 1] as number;
        const B = rgba[o + 2] as number;
        r += R;
        g += G;
        b += B;
        q += R * R + G * G + B * B;
        e += mag[y * width + x] as number;
        const i = (y + 1) * W + x + 1;
        const up = y * W + x + 1;
        sr[i] = (sr[up] as number) + r;
        sg[i] = (sg[up] as number) + g;
        sb[i] = (sb[up] as number) + b;
        sq[i] = (sq[up] as number) + q;
        se[i] = (se[up] as number) + e;
      }
    }
    const sum = (t: Float64Array, x: number, y: number, w: number, h: number): number =>
      (t[(y + h) * W + x + w] as number) -
      (t[y * W + x + w] as number) -
      (t[(y + h) * W + x] as number) +
      (t[y * W + x] as number);

    const node = (x: number, y: number, w: number, h: number): Tile => {
      const area = w * h;
      const mr = sum(sr, x, y, w, h) / area;
      const mg = sum(sg, x, y, w, h) / area;
      const mb = sum(sb, x, y, w, h) / area;
      const variance = Math.max(0, sum(sq, x, y, w, h) / area - (mr * mr + mg * mg + mb * mb));
      const edge = sum(se, x, y, w, h) / area;
      const detail = (Math.sqrt(variance / 3) + 0.25 * edge) * Math.sqrt(area);
      return { x, y, w, h, colour: `#${hex(mr)}${hex(mg)}${hex(mb)}`, detail };
    };

    const leaves: Tile[] = [node(0, 0, width, height)];
    const min = Math.max(1, minTile);
    const splittable = (t: Tile): boolean => t.w >= 2 * min && t.h >= 2 * min;
    while (leaves.length + 3 <= maxTiles) {
      let best = -1;
      for (let i = 0; i < leaves.length; i++) {
        const t = leaves[i] as Tile;
        if (!splittable(t)) continue;
        const b = best >= 0 ? (leaves[best] as Tile) : null;
        if (!b || t.detail > b.detail || (t.detail === b.detail && (t.y < b.y || (t.y === b.y && t.x < b.x)))) best = i;
      }
      if (best < 0) break;
      const t = leaves[best] as Tile;
      // Uniform regions are not worth splitting further.
      if (t.detail < 2 * Math.sqrt(t.w * t.h)) break;
      const hw = t.w >> 1;
      const hh = t.h >> 1;
      leaves.splice(
        best,
        1,
        node(t.x, t.y, hw, hh),
        node(t.x + hw, t.y, t.w - hw, hh),
        node(t.x, t.y + hh, hw, t.h - hh),
        node(t.x + hw, t.y + hh, t.w - hw, t.h - hh),
      );
    }
    return leaves;
  }

  function analyze(rgba: Uint8ClampedArray, width: number, height: number, opts: AnalyzeOptions): Analysis {
    if (!(width > 0 && height > 0) || rgba.length < width * height * 4) {
      throw new RangeError("analyze: pixel buffer does not match the given size");
    }
    let hasAlpha = false;
    let lumaSum = 0;
    let opaque = 0;
    for (let i = 3; i < width * height * 4; i += 4) {
      const a = rgba[i] as number;
      if (a < 255) hasAlpha = true;
      if (a > 0) {
        lumaSum +=
          (0.299 * (rgba[i - 3] as number) + 0.587 * (rgba[i - 2] as number) + 0.114 * (rgba[i - 1] as number)) / 255;
        opaque++;
      }
    }
    const gray = blur(luma(rgba, width, height, opts.backgroundLuma), width, height);
    const { mag, dir } = sobel(gray, width, height);
    const nms = suppress(mag, dir, width, height);

    // Adaptive thresholds from the distribution of suppressed magnitudes.
    let maxMag = 0;
    for (let i = 0; i < nms.length; i++) if ((nms[i] as number) > maxMag) maxMag = nms[i] as number;
    const strokes: Stroke[] = [];
    let edgePixels = 0;
    let strokeCandidates = 0;
    if (maxMag > 0) {
      const bins = 256;
      const hist = new Uint32Array(bins);
      let count = 0;
      for (let i = 0; i < nms.length; i++) {
        const m = nms[i] as number;
        if (m > 0) {
          hist[Math.min(bins - 1, Math.floor((m / maxMag) * bins))]++;
          count++;
        }
      }
      // High threshold at the 80th percentile of edge candidates, never below a noise floor.
      let acc = 0;
      let p80 = bins - 1;
      for (let b = 0; b < bins; b++) {
        acc += hist[b] as number;
        if (acc >= count * 0.8) {
          p80 = b;
          break;
        }
      }
      const high = Math.max(((p80 + 1) / bins) * maxMag, 48);
      const low = high * 0.45;
      const edges = hysteresis(nms, width, height, low, high);
      for (let i = 0; i < edges.length; i++) edgePixels += edges[i] as number;
      for (const raw of link(edges, width, height)) {
        const pts = simplify(raw, opts.epsilon);
        const length = polylineLength(pts);
        if (length < opts.minStrokeLength) continue;
        strokes.push({ points: pts, strength: Math.min(1, meanAlong(raw, mag, width) / 1020), length });
      }
      // Strongest and longest first; position breaks ties so the order is stable.
      strokes.sort((a, b) => {
        const d = b.strength * Math.sqrt(b.length) - a.strength * Math.sqrt(a.length);
        if (d !== 0) return d;
        return (a.points[1] as number) - (b.points[1] as number) || (a.points[0] as number) - (b.points[0] as number);
      });
      strokeCandidates = strokes.length;
      if (strokes.length > opts.maxStrokes) strokes.length = Math.max(0, opts.maxStrokes);
    }
    const tiles = quadtree(rgba, mag, width, height, Math.max(1, opts.maxTiles), opts.minTile);
    const meanLuma = opaque > 0 ? lumaSum / opaque : 1;
    return { width, height, strokes, tiles, meanLuma, hasAlpha, edgePixels, strokeCandidates };
  }

  return { analyze, luma, blur, sobel, suppress, hysteresis, link, simplify, quadtree };
}
