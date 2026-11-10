/**
 * A tiny swarm: cursors that drift toward their next task while keeping some
 * distance from each other. Deterministic, so the same seed draws the same path.
 *
 * SPDX-License-Identifier: MIT
 */

interface Vec {
  x: number;
  y: number;
}

interface Cursor {
  name: string;
  pos: Vec;
  vel: Vec;
  target: Vec;
}

/** mulberry32: a small, fast, seedable PRNG returning numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const length = (a: Vec): number => Math.hypot(a.x, a.y);

function limit(v: Vec, max: number): Vec {
  const len = length(v);
  return len > max ? scale(v, max / len) : v;
}

/** Steering toward the target that slows down inside `radius`. */
function arrive(c: Cursor, radius = 80): Vec {
  const offset = sub(c.target, c.pos);
  const distance = length(offset);
  if (distance < 1e-6) return { x: 0, y: 0 };
  const speed = distance < radius ? (distance / radius) * 6 : 6;
  return sub(scale(offset, speed / distance), c.vel);
}

/** Push away from neighbours closer than `space` pixels. */
function separate(c: Cursor, all: readonly Cursor[], space = 28): Vec {
  let push: Vec = { x: 0, y: 0 };
  for (const other of all) {
    if (other === c) continue;
    const away = sub(c.pos, other.pos);
    const d = length(away);
    if (d > 0 && d < space) push = add(push, scale(away, (space - d) / (d * space)));
  }
  return scale(push, 4);
}

/** Advances every cursor by one 60 fps frame. */
export function step(swarm: Cursor[]): void {
  for (const c of swarm) {
    const force = add(arrive(c), separate(c, swarm));
    c.vel = limit(add(c.vel, scale(force, 0.12)), 6);
  }
  for (const c of swarm) c.pos = add(c.pos, c.vel);
}

/** Creates `count` cursors around the centre of a `w` x `h` stage. */
export function createSwarm(count: number, w: number, h: number, seed = 1): Cursor[] {
  const rng = seeded(seed);
  const names = ["Ada", "Lin", "Mo", "Noor", "Sol", "Tae", "Uma", "Vik"];
  return Array.from({ length: count }, (_, i) => ({
    name: names[i % names.length] ?? `cursor ${i + 1}`,
    pos: { x: w / 2 + (rng() - 0.5) * 40, y: h / 2 + (rng() - 0.5) * 40 },
    vel: { x: 0, y: 0 },
    target: { x: rng() * w, y: rng() * h },
  }));
}
