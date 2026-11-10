#!/usr/bin/env node
/**
 * Generates the low-poly loom shuttle samples: examples/3d/shuttle.glb, shuttle.obj,
 * shuttle.stl and shuttle.ply. One original shape (a weaving shuttle with a bobbin of thread),
 * exported in four formats so each exercises its own path:
 *   - GLB: three meshes with palette PBR materials, Y-up;
 *   - OBJ: three named objects (body, bobbin, thread) without materials, Y-up, 5 decimals;
 *   - STL: binary, Z-up as 3D-printing tools write it;
 *   - PLY: binary little endian with per-vertex colours from the SwarmLoom palette.
 * Original work, released under the project licence (MIT). Deterministic output.
 *
 * Usage: node packages/adapter-three/scripts/gen-shuttle.mjs [out-dir]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2,
} from "three";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { PLYExporter } from "three/addons/exporters/PLYExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { exportGlb } from "./glb.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(here, "../../../examples/3d"));

/** Keeps position and normal only, welded, so parts merge and export compactly. */
function clean(geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  }
  return geometry.index ? geometry : mergeVertices(geometry);
}

/** The welded tips of the lathe get no normal from their degenerate fans: point them outward. */
function fixTipNormals(geometry) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < normal.count; i++) {
    if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) > 1e-6) continue;
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(i, x / length, y / length, z / length);
  }
  return geometry;
}

/**
 * Shuttle body: a lathe profile (pointed both ends) flattened into a boat shape,
 * lying along X. Faceted on purpose (low poly).
 */
function body() {
  const profile = [
    [0, -1.2],
    [0.1, -1.05],
    [0.22, -0.7],
    [0.3, -0.3],
    [0.32, 0],
    [0.3, 0.3],
    [0.22, 0.7],
    [0.1, 1.05],
    [0, 1.2],
  ].map(([r, y]) => new Vector2(r, y));
  const g = clean(new LatheGeometry(profile, 10));
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.62, 1);
  g.computeVertexNormals();
  return fixTipNormals(g);
}

/** Bobbin sitting in the shuttle's open middle: a core and two flanges. */
function bobbin() {
  const core = clean(new CylinderGeometry(0.07, 0.07, 0.9, 10));
  core.rotateZ(Math.PI / 2);
  const parts = [core];
  for (const x of [-0.42, 0.42]) {
    const flange = clean(new CylinderGeometry(0.15, 0.15, 0.05, 10));
    flange.rotateZ(Math.PI / 2);
    flange.translate(x, 0, 0);
    parts.push(flange);
  }
  const g = mergeGeometries(parts, false);
  g.translate(0, 0.2, 0);
  return g;
}

/** Windings of thread on the bobbin. */
function thread() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const ring = clean(new TorusGeometry(0.11, 0.04, 6, 14));
    ring.rotateY(Math.PI / 2);
    ring.translate(-0.28 + i * 0.14, 0.2, 0);
    parts.push(ring);
  }
  return mergeGeometries(parts, false);
}

const PALETTE = { body: "#F5A524", bobbin: "#5B5BF7", thread: "#D946EF" };
const pieces = [
  ["Body", body(), PALETTE.body],
  ["Bobbin", bobbin(), PALETTE.bobbin],
  ["Thread", thread(), PALETTE.thread],
];

/** Palette PBR material of a piece (GLB only; the other formats carry no materials). */
function material(name, hex) {
  return new MeshStandardMaterial({ name, color: new Color(hex), roughness: 0.5, metalness: 0.05 });
}

function scene({ colors = false, zUp = false, materials = false } = {}) {
  const group = new Group();
  for (const [name, geometry, hex] of pieces) {
    const g = geometry.clone();
    if (zUp) g.rotateX(Math.PI / 2);
    if (colors) {
      const c = new Color(hex);
      const n = g.getAttribute("position").count;
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) rgb.set([c.r * 255, c.g * 255, c.b * 255].map(Math.round), i * 3);
      g.setAttribute("color", new BufferAttribute(rgb, 3, true));
    }
    const mesh = new Mesh(g, materials ? material(name, hex) : new MeshStandardMaterial({ name }));
    mesh.name = name;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return group;
}

/** Number rounded to 5 decimals without float noise or negative zero ("1.2", not "1.2000000476837158"). */
function compactNumber(text) {
  const value = Math.round(Number(text) * 1e5) / 1e5;
  return Object.is(value, -0) ? "0" : String(value);
}

/** Shortens the coordinates of OBJ vertex, normal and texture lines and drops material references. */
function compactObj(text) {
  return text
    .replace(/^usemtl .*\n/gm, "")
    .replace(/^(v|vn|vt) (.+)$/gm, (_line, tag, rest) => `${tag} ${rest.split(" ").map(compactNumber).join(" ")}`);
}

mkdirSync(outDir, { recursive: true });
const header = "# SwarmLoom sample: low-poly loom shuttle (MIT). Generated by gen-shuttle.mjs.\n";
writeFileSync(resolve(outDir, "shuttle.obj"), header + compactObj(new OBJExporter().parse(scene())));
const root = scene({ materials: true });
root.name = "Loom Shuttle";
writeFileSync(resolve(outDir, "shuttle.glb"), await exportGlb(root));
const stl = new STLExporter().parse(scene({ zUp: true }), { binary: true });
writeFileSync(resolve(outDir, "shuttle.stl"), new Uint8Array(stl.buffer, stl.byteOffset, stl.byteLength));
const ply = new PLYExporter().parse(scene({ colors: true }), null, {
  binary: true,
  littleEndian: true,
  excludeAttributes: ["uv"],
});
writeFileSync(resolve(outDir, "shuttle.ply"), new Uint8Array(ply));
let triangles = 0;
for (const [, g] of pieces) triangles += (g.index?.count ?? g.getAttribute("position").count) / 3;
console.log(`wrote shuttle.glb/.obj/.stl/.ply to ${outDir}: ${triangles} triangles each`);
