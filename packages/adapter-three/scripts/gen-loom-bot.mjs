#!/usr/bin/env node
/**
 * Generates examples/3d/loom-bot.glb: "Loom Bot", a small stylised robot holding a thread
 * spool, built from primitives in the SwarmLoom palette. Original work, released under the
 * project licence (MIT).
 *
 * Usage: node packages/adapter-three/scripts/gen-loom-bot.mjs [out.glb]
 *
 * The output is deterministic (no randomness, fixed tessellation), so regenerating it only
 * changes the file when this script or three.js changes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { exportGlb } from "./glb.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, "../../../examples/3d/loom-bot.glb"));

/** SwarmLoom palette (contracts/brand.md). */
const PALETTE = {
  indigo: "#5B5BF7",
  coral: "#FF6B5B",
  teal: "#14B8A6",
  amber: "#F5A524",
  orchid: "#D946EF",
  violet: "#9B5CF6",
  ink: "#1C1C2A",
  paper: "#F4F4F8",
};

function material(name, color, extra = {}) {
  return new MeshStandardMaterial({ name, color: new Color(color), roughness: 0.45, metalness: 0.05, ...extra });
}

const MATERIALS = {
  shell: material("Shell", PALETTE.indigo, { roughness: 0.35, metalness: 0.15 }),
  head: material("Head", PALETTE.paper, { roughness: 0.5 }),
  visor: material("Visor", PALETTE.ink, { roughness: 0.18, metalness: 0.3 }),
  eyes: material("Eyes", PALETTE.teal, { emissive: new Color(PALETTE.teal), emissiveIntensity: 1.4 }),
  limbs: material("Limbs", PALETTE.amber, { roughness: 0.4 }),
  accent: material("Accent", PALETTE.coral, { roughness: 0.4 }),
  thread: material("Thread", PALETTE.orchid, { roughness: 0.65 }),
  joints: material("Joints", PALETTE.violet, { roughness: 0.45 }),
};

/** Parts per material: [geometry, position, rotation (degrees)]. */
const parts = Object.fromEntries(Object.keys(MATERIALS).map((key) => [key, []]));

function add(key, geometry, [x, y, z], [rx, ry, rz] = [0, 0, 0]) {
  const d = Math.PI / 180;
  const matrix = new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx * d, ry * d, rz * d)),
    new Vector3(1, 1, 1),
  );
  // Positions and normals only (no textures): one compact primitive per material.
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  }
  const g = geometry.index ? geometry : mergeVertices(geometry);
  g.applyMatrix4(matrix);
  parts[key].push(g);
}

// Torso, chest emblem (a loop of thread) and belt.
add("shell", new RoundedBoxGeometry(0.92, 0.78, 0.62, 3, 0.16), [0, 0.86, 0]);
add("accent", new TorusGeometry(0.11, 0.035, 10, 28), [0, 0.92, 0.315]);
add("joints", new CylinderGeometry(0.4, 0.42, 0.1, 28), [0, 0.47, 0]);

// Neck and head with visor, eyes and antenna.
add("joints", new CylinderGeometry(0.12, 0.14, 0.14, 20), [0, 1.3, 0]);
add("head", new RoundedBoxGeometry(0.78, 0.56, 0.6, 3, 0.18), [0, 1.62, 0]);
add("visor", new RoundedBoxGeometry(0.62, 0.26, 0.08, 2, 0.04), [0, 1.64, 0.29]);
add("eyes", new SphereGeometry(0.055, 16, 10), [-0.14, 1.65, 0.335]);
add("eyes", new SphereGeometry(0.055, 16, 10), [0.14, 1.65, 0.335]);
add("joints", new CylinderGeometry(0.018, 0.022, 0.26, 10), [0, 2.02, 0]);
add("accent", new SphereGeometry(0.07, 18, 12), [0, 2.17, 0]);
for (const side of [-1, 1])
  add("accent", new CylinderGeometry(0.07, 0.07, 0.06, 18), [side * 0.42, 1.62, 0], [0, 0, 90]);

// Arms: shoulders, upper and lower arms, hands. The right arm is raised, holding the spool.
for (const side of [-1, 1]) add("joints", new SphereGeometry(0.11, 18, 12), [side * 0.53, 1.08, 0]);
add("limbs", new CapsuleGeometry(0.075, 0.34, 4, 14), [-0.66, 0.86, 0.02], [0, 0, -18]);
add("limbs", new CapsuleGeometry(0.07, 0.28, 4, 14), [-0.72, 0.52, 0.1], [24, 0, -6]);
add("joints", new SphereGeometry(0.085, 16, 10), [-0.74, 0.32, 0.18]);
add("limbs", new CapsuleGeometry(0.075, 0.34, 4, 14), [0.68, 1.18, 0.06], [0, 0, -52]);
add("limbs", new CapsuleGeometry(0.07, 0.28, 4, 14), [0.9, 1.44, 0.14], [-20, 0, -14]);
add("joints", new SphereGeometry(0.085, 16, 10), [0.95, 1.66, 0.2]);

// Thread spool in the raised hand: core, flanges and a few windings.
add("head", new CylinderGeometry(0.05, 0.05, 0.34, 16), [0.95, 1.8, 0.2], [0, 0, 90]);
for (const dx of [-0.16, 0.16])
  add("joints", new CylinderGeometry(0.11, 0.11, 0.03, 24), [0.95 + dx, 1.8, 0.2], [0, 0, 90]);
for (const dx of [-0.09, -0.03, 0.03, 0.09]) {
  add("thread", new TorusGeometry(0.075, 0.03, 8, 24), [0.95 + dx, 1.8, 0.2], [0, 90, 0]);
}

// Legs and feet.
for (const side of [-1, 1]) {
  add("joints", new SphereGeometry(0.1, 16, 10), [side * 0.22, 0.38, 0]);
  add("limbs", new CapsuleGeometry(0.085, 0.2, 4, 14), [side * 0.22, 0.2, 0]);
  add("shell", new RoundedBoxGeometry(0.26, 0.1, 0.38, 2, 0.045), [side * 0.22, 0.03, 0.05]);
}

const robot = new Group();
robot.name = "Loom Bot";
for (const [key, geometries] of Object.entries(parts)) {
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error(`could not merge parts of ${key}`);
  const mesh = new Mesh(merged, MATERIALS[key]);
  mesh.name = MATERIALS[key].name;
  robot.add(mesh);
}

const glb = await exportGlb(robot);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
let triangles = 0;
robot.traverse((o) => {
  if (o.isMesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
});
console.log(`wrote ${out}: ${glb.byteLength} bytes, ${triangles} triangles`);
