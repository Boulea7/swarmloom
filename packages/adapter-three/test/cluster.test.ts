import { SphereGeometry, TorusKnotGeometry } from "three";
import { describe, expect, it } from "vitest";
import { clusterItems } from "../src/mesh/cluster";
import { decimateSoups } from "../src/mesh/decimate";
import type { FaceSoup } from "../src/mesh/soup";
import { buildLayers } from "../src/plan/layers";
import { planMesh } from "../src/plan/plan";
import type { Projector } from "../src/plan/types";

/** Triangle soup of a three.js primitive (non-indexed copy). */
function soupOf(geometry: SphereGeometry | TorusKnotGeometry, material = 0): FaceSoup {
  const flat = geometry.toNonIndexed();
  return {
    material,
    positions: Float32Array.from(flat.getAttribute("position").array),
    normals: Float32Array.from(flat.getAttribute("normal").array),
    uvs: null,
    colors: null,
  };
}

/** Orthographic stand-in for the build camera: model units to an 800 x 600 stage. */
const project: Projector = (x, y, _z, out) => {
  out.x = 400 + x * 250;
  out.y = 300 - y * 250;
  return true;
};

function patchOfEachTriangle(plan: ReturnType<typeof planMesh>, triangles: number): Int32Array {
  const seen = new Int32Array(triangles).fill(0);
  let offset = 0;
  for (const face of plan.faces) {
    const n = face.soup.positions.length / 9;
    for (const range of face.ranges) for (let t = range.start; t < range.start + range.count; t++) seen[offset + t]++;
    offset += n;
  }
  return seen;
}

describe("patch clustering", () => {
  it("assigns every triangle to exactly one non-empty patch within the bound", () => {
    const soups = [soupOf(new TorusKnotGeometry(0.6, 0.2, 160, 16), 0), soupOf(new SphereGeometry(0.3, 24, 16), 1)];
    const triangles = soups.reduce((n, s) => n + s.positions.length / 9, 0);
    const plan = planMesh(soups, ["A", "B"], { w: 800, h: 600 }, project, {
      maxPatches: 48,
      maxPoints: 4000,
      maxEdges: 3000,
    });

    expect(plan.patches.length).toBeGreaterThan(1);
    expect(plan.patches.length).toBeLessThanOrEqual(48);
    expect(Array.from(patchOfEachTriangle(plan, triangles)).every((c) => c === 1)).toBe(true);
    expect(plan.patches.reduce((n, p) => n + p.triangles, 0)).toBe(triangles);
    expect(plan.patches.every((p) => p.triangles > 0)).toBe(true);
    // Each soup's triangles are grouped: one contiguous range per patch.
    for (const face of plan.faces) {
      const patches = face.ranges.map((r) => r.patch);
      expect(new Set(patches).size).toBe(patches.length);
    }
    expect(plan.points.count).toBeLessThanOrEqual(4000);
    expect(plan.edges.count).toBeLessThanOrEqual(3000);
  });

  it("keeps patches and layers within maxLayers", () => {
    const soups = [soupOf(new TorusKnotGeometry(0.6, 0.2, 200, 24))];
    const plan = planMesh(soups, [""], { w: 800, h: 600 }, project, {
      maxPatches: 400,
      maxPoints: 60_000,
      maxEdges: 40_000,
      maxLayers: 90,
    });
    expect(buildLayers(plan).length).toBeLessThanOrEqual(90);
  });

  it("never returns more clusters than items, deterministically", () => {
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
    const a = clusterItems({ positions }, { k: 400 });
    const b = clusterItems({ positions }, { k: 400 });
    expect(a.count).toBeLessThanOrEqual(5);
    expect(Array.from(a.sizes).reduce((s, n) => s + n, 0)).toBe(5);
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    expect(() => clusterItems({ positions }, { k: 0 })).toThrow(RangeError);
  });

  it("decimates to the triangle budget", () => {
    const soups = [soupOf(new SphereGeometry(1, 96, 64))];
    const result = decimateSoups(soups, 2000);
    expect(result.before).toBeGreaterThan(2000);
    expect(result.after).toBeLessThanOrEqual(2000);
    expect(result.after).toBeGreaterThan(500);
  });
});
