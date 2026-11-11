import { createRng } from "../rng";
import type { Rng } from "../types";

/**
 * Derives an independent 32-bit seed from a root seed and a stream key (FNV-1a over the key,
 * then a murmur3-style finalizer). Streams keyed by stable ids (agent index, layer id) keep
 * their sequences when unrelated agents or layers are added or removed.
 */
export function streamSeed(root: number, key: string): number {
  let h = (root >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seeded PRNG for the stream `key` of the root seed. */
export function streamRng(root: number, key: string): Rng {
  return createRng(streamSeed(root, key));
}
