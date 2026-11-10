/**
 * Feature detection for the Web Audio constructors, including the prefixed names older WebKit
 * builds (Safari < 14.1) still expose.
 */

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;
type OfflineAudioContextCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

interface PrefixedAudioGlobals {
  webkitAudioContext?: AudioContextCtor;
  webkitOfflineAudioContext?: OfflineAudioContextCtor;
}

function prefixed(): PrefixedAudioGlobals {
  return globalThis as unknown as PrefixedAudioGlobals;
}

/** The realtime `AudioContext` constructor, or null outside a Web Audio capable environment. */
export function audioContextCtor(): AudioContextCtor | null {
  if (typeof globalThis.AudioContext === "function") return globalThis.AudioContext;
  return prefixed().webkitAudioContext ?? null;
}

/** The `OfflineAudioContext` constructor, or null outside a Web Audio capable environment. */
export function offlineContextCtor(): OfflineAudioContextCtor | null {
  if (typeof globalThis.OfflineAudioContext === "function") return globalThis.OfflineAudioContext;
  return prefixed().webkitOfflineAudioContext ?? null;
}

/**
 * Creates a low-latency realtime context. Some engines reject the options bag, so a bare
 * constructor call is tried next.
 *
 * @returns The context, or null when Web Audio is missing or construction fails (sound is then
 *   unavailable; callers degrade to silence).
 */
export function createRealtimeContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}
